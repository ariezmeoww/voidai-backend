import * as fs from 'fs/promises';
import { join } from 'path';
import { ProviderRegistry } from './provider.registry';
import type { BaseProviderAdapter } from '../base';
import type { ILogger } from '../../../core/logging';
import type { ProviderService } from '../../../domain/provider/services';

interface AdapterMetadata {
  name: string;
  className: string;
  requiresApiKey: boolean;
  hasStaticApiKey: boolean;
  constructorParams: string[];
}

interface ProviderData {
  name: string;
  needsSubProviders: boolean;
  priority: number;
  baseUrl: string;
  timeout: number;
  supportedModels: string[];
  rateLimits: {
    requestsPerMinute: number;
    requestsPerHour: number;
    tokensPerMinute: number;
  };
  features: string[];
}

interface SyncStats {
  totalAdapters: number;
  providersCreated: number;
  providersUpdated: number;
  providersDeleted: number;
  existingProviders: number;
}

export class ProviderInitializationService {
  private static readonly ADAPTERS_PATH_RELATIVE = '../adapters';
  private static readonly ADAPTER_FILE_PATTERNS = ['.adapter.ts', '.adapter.js'];
  private static readonly EXCLUDED_FILES = ['index.ts', 'index.js'];
  private static readonly DEFAULT_TOKENS_PER_MINUTE = 50000000;

  private readonly adaptersPath: string;
  private providerRegistry: ProviderRegistry;
  private logger: ILogger;
  private providerService?: ProviderService;

  constructor(
    providerRegistry: ProviderRegistry,
    logger: ILogger,
    providerService?: ProviderService
  ) {
    this.providerRegistry = providerRegistry;
    this.logger = logger;
    this.providerService = providerService;
    this.adaptersPath = join(__dirname, ProviderInitializationService.ADAPTERS_PATH_RELATIVE);
  }

  async initializeProviders(): Promise<void> {
    try {
      this.logger.info('Starting dynamic provider initialization');

      await this.discoverAndRegisterAdapters();
      await this.syncProvidersToDatabase();

      this.logInitializationComplete();

    } catch (error) {
      this.logger.error('Provider initialization failed', error as Error);
      throw error;
    }
  }

  private async discoverAndRegisterAdapters(): Promise<void> {
    try {
      this.logger.debug('Starting adapter discovery', {
        metadata: { adaptersPath: this.adaptersPath }
      });
      
      const adapterFiles = await this.getAdapterFiles();
      
      this.logger.debug('Found adapter files', {
        metadata: {
          adapterFiles: adapterFiles.length,
          files: adapterFiles
        }
      });

      await this.registerAdaptersFromFiles(adapterFiles);

      this.logger.debug('Adapter registration completed', {
        metadata: {
          registeredAdapters: this.providerRegistry.getAllAdapterNames().length,
          adapterNames: this.providerRegistry.getAllAdapterNames()
        }
      });

    } catch (error) {
      this.logger.error('Failed to discover adapters', error as Error);
      throw error;
    }
  }

  private async getAdapterFiles(): Promise<string[]> {
    const files = await fs.readdir(this.adaptersPath);
    return files.filter(file => this.isAdapterFile(file));
  }

  private isAdapterFile(file: string): boolean {
    const isAdapterFile = ProviderInitializationService.ADAPTER_FILE_PATTERNS.some(pattern => 
      file.endsWith(pattern)
    );
    const isNotExcluded = !ProviderInitializationService.EXCLUDED_FILES.includes(file);
    
    return isAdapterFile && isNotExcluded;
  }

  private async registerAdaptersFromFiles(files: string[]): Promise<void> {
    for (const file of files) {
      try {
        await this.registerAdapterFromFile(file);
      } catch (error) {
        this.logger.warn('Failed to register adapter from file', {
          metadata: {
            file,
            error: (error as Error).message
          }
        });
      }
    }
  }

  private async registerAdapterFromFile(file: string): Promise<void> {
    const filePath = join(this.adaptersPath, file);
    const adapterModule = await import(filePath);
    
    const adapterClasses = this.extractAdapterClasses(adapterModule);

    for (const AdapterClass of adapterClasses) {
      await this.registerAdapter(AdapterClass, file);
    }
  }

  private extractAdapterClasses(adapterModule: any): Array<new (...args: any[]) => BaseProviderAdapter> {
    return Object.values(adapterModule).filter(
      (exported: any) =>
        typeof exported === 'function' &&
        exported.name.endsWith('Adapter')
    ) as Array<new (...args: any[]) => BaseProviderAdapter>;
  }

  private async registerAdapter(
    AdapterClass: new (...args: any[]) => BaseProviderAdapter, 
    file: string
  ): Promise<void> {
    try {
      const metadata = await this.extractAdapterMetadata(file, AdapterClass);
      const dummyAdapter = await this.createDummyAdapter(AdapterClass, file);
      
      if (!dummyAdapter) {
        return;
      }
      
      const factory = () => this.createAdapterInstance(AdapterClass, metadata);
      this.providerRegistry.registerAdapterFactory(metadata.name, factory);

      this.logger.debug('Adapter registered', {
        metadata: {
          adapterName: metadata.name,
          supportedModels: dummyAdapter.supportedModels.length
        }
      });

    } catch (error) {
      this.logger.warn('Failed to register adapter', {
        metadata: {
          className: AdapterClass.name,
          file,
          error: (error as Error).message
        }
      });
    }
  }

  private async createDummyAdapter(
    AdapterClass: new (...args: any[]) => BaseProviderAdapter,
    file: string
  ): Promise<BaseProviderAdapter | null> {
    const strategies = [
      () => new AdapterClass(this.logger),
      () => new AdapterClass('dummy-key', this.logger),
      () => new AdapterClass('dummy-key', this.logger, null, {}),
      () => new AdapterClass('dummy-key', this.logger, undefined, undefined)
    ];

    for (const strategy of strategies) {
      try {
        return strategy();
      } catch {}
    }

    this.logger.warn('Failed to instantiate adapter', {
      metadata: {
        className: AdapterClass.name,
        file
      }
    });

    return null;
  }

  private async extractAdapterMetadata(file: string, AdapterClass: any): Promise<AdapterMetadata> {
    const filePath = join(this.adaptersPath, file);
    const content = await fs.readFile(filePath, 'utf-8');
    
    const hasStaticApiKey = content.includes('private static readonly API_KEY') ||
                           content.includes('private static readonly apiKey');
    
    return {
      name: this.extractAdapterName(file),
      className: AdapterClass.name,
      hasStaticApiKey,
      requiresApiKey: content.includes('requiresApiKey: true'),
      constructorParams: this.extractConstructorParams(content)
    };
  }

  private extractAdapterName(file: string): string {
    return file
      .replace(/\.(adapter\.ts|adapter\.js)$/, '')
      .toLowerCase()
      .replace('.', '-');
  }

  private extractConstructorParams(content: string): string[] {
    const constructorMatch = content.match(/constructor\s*$([\s\S]*?)$\s*{/);
    if (!constructorMatch) {
      return [];
    }

    const paramsString = constructorMatch[1];
    return paramsString
      .split(',')
      .map(param => param.trim().split(':')[0].trim())
      .filter(param => param && !param.includes('private') && !param.includes('public'));
  }

  private createAdapterInstance(AdapterClass: any, metadata: AdapterMetadata): BaseProviderAdapter {
    try {
      if (metadata.hasStaticApiKey || !metadata.requiresApiKey) {
        return new AdapterClass(this.logger);
      }

      if (metadata.constructorParams.includes('modelMapping')) {
        return new AdapterClass('dummy-key', this.logger, undefined);
      }

      return new AdapterClass('dummy-key', this.logger);

    } catch (error) {
      console.error(`Failed to create adapter instance for ${metadata.name}:`, error);
      console.error('Metadata:', metadata);
      throw error;
    }
  }

  private async syncProvidersToDatabase(): Promise<void> {
    if (!this.providerService) {
      this.logger.debug('Provider service not available, skipping database sync');
      return;
    }

    try {
      this.logger.info('Starting provider database synchronization');

      const syncStats = await this.performDatabaseSync();
      this.logSyncComplete(syncStats);

    } catch (error) {
      this.logger.error('Provider database synchronization failed', error as Error);
    }
  }

  private async performDatabaseSync(): Promise<SyncStats> {
    const adapterNames = this.providerRegistry.getAllAdapterNames();
    const existingProviders = await this.providerService!.getProviders({});
    
    const stats: SyncStats = {
      totalAdapters: adapterNames.length,
      providersCreated: 0,
      providersUpdated: 0,
      providersDeleted: 0,
      existingProviders: existingProviders.length
    };

    await this.syncAdaptersToProviders(adapterNames, stats);
    await this.deleteObsoleteProviders(adapterNames, existingProviders, stats);

    return stats;
  }

  private async syncAdaptersToProviders(adapterNames: string[], stats: SyncStats): Promise<void> {
    for (const adapterName of adapterNames) {
      try {
        const syncResult = await this.syncSingleAdapter(adapterName);
        if (syncResult === 'created') {
          stats.providersCreated++;
        } else if (syncResult === 'updated') {
          stats.providersUpdated++;
        }
      } catch (error) {
        this.logger.error('Failed to sync provider to database', error as Error, {
          metadata: { providerName: adapterName }
        });
      }
    }
  }

  private async syncSingleAdapter(adapterName: string): Promise<'created' | 'updated' | 'skipped'> {
    const adapter = this.providerRegistry.getAdapter(adapterName);
    if (!adapter) {
      return 'skipped';
    }

    const existingProvider = await this.providerService!.getProviderByName(adapterName);
    const providerData = this.createProviderData(adapterName, adapter);
    
    if (!existingProvider) {
      await this.providerService!.createProvider(providerData);
      this.logger.info('Created provider in database', {
        metadata: {
          providerName: adapterName,
          supportedModels: adapter.supportedModels.length
        }
      });
      return 'created';
    }

    if (this.hasProviderDataChanged(existingProvider, providerData)) {
      await this.updateExistingProvider(existingProvider, providerData);
      this.logger.debug('Updated provider in database', {
        metadata: { providerName: adapterName }
      });
      return 'updated';
    }

    return 'skipped';
  }

  private createProviderData(adapterName: string, adapter: BaseProviderAdapter): ProviderData {
    return {
      name: adapterName,
      needsSubProviders: adapter.configuration.requiresApiKey,
      priority: 1,
      baseUrl: adapter.configuration.baseUrl,
      timeout: adapter.configuration.timeout,
      supportedModels: [...adapter.supportedModels],
      rateLimits: {
        requestsPerMinute: adapter.configuration.rateLimitPerMinute,
        requestsPerHour: adapter.configuration.rateLimitPerMinute * 60,
        tokensPerMinute: ProviderInitializationService.DEFAULT_TOKENS_PER_MINUTE
      },
      features: this.extractFeatures(adapter.configuration.capabilities)
    };
  }

  private extractFeatures(capabilities: any): string[] {
    return Object.entries(capabilities)
      .filter(([_, enabled]) => enabled)
      .map(([capability]) => capability);
  }

  private async updateExistingProvider(existingProvider: any, providerData: ProviderData): Promise<void> {
    await this.providerService!.updateProvider(existingProvider.id, {
      needsSubProviders: providerData.needsSubProviders,
      baseUrl: providerData.baseUrl,
      timeout: providerData.timeout,
      supportedModels: providerData.supportedModels,
      rateLimits: providerData.rateLimits,
      features: providerData.features
    });
  }

  private async deleteObsoleteProviders(
    adapterNames: string[], 
    existingProviders: any[], 
    stats: SyncStats
  ): Promise<void> {
    const adapterNamesSet = new Set(adapterNames);
    const providersToDelete = existingProviders.filter(p => !adapterNamesSet.has(p.name));
    
    for (const provider of providersToDelete) {
      try {
        await this.providerService!.deleteProvider(provider.id);
        stats.providersDeleted++;
        
        this.logger.info('Deleted obsolete provider from database', {
          metadata: { providerName: provider.name }
        });
      } catch (error) {
        this.logger.error('Failed to delete provider from database', error as Error, {
          metadata: { providerName: provider.name }
        });
      }
    }
  }

  private hasProviderDataChanged(existingProvider: any, newProviderData: ProviderData): boolean {
    const checks = [
      () => existingProvider.displayName !== newProviderData.name,
      () => existingProvider.needsSubProviders !== newProviderData.needsSubProviders,
      () => existingProvider.baseUrl !== newProviderData.baseUrl,
      () => existingProvider.timeout !== newProviderData.timeout
    ];

    for (const check of checks) {
      if (check()) {
        return true;
      }
    }

    return this.hasModelsChanged(existingProvider, newProviderData) ||
           this.hasFeaturesChanged(existingProvider, newProviderData) ||
           this.hasRateLimitsChanged(existingProvider, newProviderData);
  }

  private hasModelsChanged(existingProvider: any, newProviderData: ProviderData): boolean {
    const currentModels = new Set(existingProvider.supportedModels || []);
    const newModels = new Set(newProviderData.supportedModels);
    
    if (currentModels.size !== newModels.size) {
      return true;
    }

    for (const model of newModels) {
      if (!currentModels.has(model)) {
        return true;
      }
    }

    return false;
  }

  private hasFeaturesChanged(existingProvider: any, newProviderData: ProviderData): boolean {
    const currentFeatures = new Set(existingProvider.features || []);
    const newFeatures = new Set(newProviderData.features);
    
    if (currentFeatures.size !== newFeatures.size) {
      return true;
    }

    for (const feature of newFeatures) {
      if (!currentFeatures.has(feature)) {
        return true;
      }
    }

    return false;
  }

  private hasRateLimitsChanged(existingProvider: any, newProviderData: ProviderData): boolean {
    const currentLimits = existingProvider.rateLimits || {};
    const newLimits = newProviderData.rateLimits;
    
    if (!currentLimits && !newLimits) {
      return false;
    }
    
    if (!currentLimits || !newLimits) {
      return true;
    }
    
    return currentLimits.requestsPerMinute !== newLimits.requestsPerMinute ||
           currentLimits.requestsPerHour !== newLimits.requestsPerHour ||
           currentLimits.tokensPerMinute !== newLimits.tokensPerMinute;
  }

  private logInitializationComplete(): void {
    const stats = this.providerRegistry.getRegistryStats();
    this.logger.info('Provider initialization completed', {
      metadata: {
        totalAdapters: stats.totalAdapters,
        totalFactories: stats.totalFactories,
        totalModels: stats.totalModels,
        capabilities: stats.adaptersByCapability
      }
    });
  }

  private logSyncComplete(stats: SyncStats): void {
    this.logger.info('Provider database synchronization completed', {
      metadata: stats
    });
  }
}