import type { BaseProviderAdapter } from '../base';
import type { ILogger } from '../../../core/logging';

interface RegistryStats {
  totalAdapters: number;
  totalFactories: number;
  totalModels: number;
  adaptersByCapability: Record<string, number>;
}

interface AdapterCreationOptions {
  apiKey: string;
  subProvider?: any;
}

type AdapterFactory = () => BaseProviderAdapter;
type AdapterConstructor = new (...args: any[]) => BaseProviderAdapter;

export class ProviderRegistry {
  private static readonly SUPPORTED_CAPABILITIES = [
    'chat',
    'audio',
    'embeddings',
    'images',
    'moderation',
    'responses'
  ] as const;

  private readonly adapters = new Map<string, BaseProviderAdapter>();
  private readonly adapterFactories = new Map<string, AdapterFactory>();

  constructor(private readonly logger: ILogger) {}

  registerAdapter(name: string, adapter: BaseProviderAdapter): void {
    this.adapters.set(name, adapter);
    this.logger.debug('Provider adapter registered', {
      metadata: { 
        providerName: name, 
        supportedModels: adapter.supportedModels.length 
      }
    });
  }

  registerAdapterFactory(name: string, factory: AdapterFactory): void {
    this.adapterFactories.set(name, factory);
    this.logger.debug('Provider adapter factory registered', {
      metadata: { providerName: name }
    });
  }

  getAdapter(name: string): BaseProviderAdapter | undefined {
    const existingAdapter = this.adapters.get(name);
    if (existingAdapter) {
      return existingAdapter;
    }

    return this.createAdapterFromFactory(name);
  }

  createAdapterWithApiKey(
    name: string,
    apiKey: string,
    subProvider?: any
  ): BaseProviderAdapter | undefined {
    const sourceAdapter = this.getSourceAdapter(name);
    if (!sourceAdapter) {
      return undefined;
    }

    const options: AdapterCreationOptions = { apiKey, subProvider };
    return this.attemptAdapterCreation(sourceAdapter, name, options);
  }

  hasAdapter(name: string): boolean {
    return this.adapters.has(name) || this.adapterFactories.has(name);
  }

  getAllAdapterNames(): string[] {
    const registeredNames = Array.from(this.adapters.keys());
    const factoryNames = Array.from(this.adapterFactories.keys());
    return [...new Set([...registeredNames, ...factoryNames])];
  }

  getAdapterForModel(model: string): BaseProviderAdapter | undefined {
    const existingAdapter = this.findAdapterInCollection(this.adapters.values(), model);
    if (existingAdapter) {
      return existingAdapter;
    }

    return this.findAdapterInFactories(model);
  }

  getAdaptersForModel(model: string): BaseProviderAdapter[] {
    const adapters: BaseProviderAdapter[] = [];

    this.addMatchingAdapters(this.adapters.values(), model, adapters);
    this.addMatchingFactoryAdapters(model, adapters);

    return adapters;
  }

  clear(): void {
    this.adapters.clear();
    this.adapterFactories.clear();
    this.logger.debug('Provider registry cleared');
  }

  getRegistryStats(): RegistryStats {
    const allAdapters = this.getAllAdapters();
    
    return {
      totalAdapters: allAdapters.length,
      totalFactories: this.adapterFactories.size,
      totalModels: this.calculateTotalModels(allAdapters),
      adaptersByCapability: this.calculateCapabilityStats(allAdapters)
    };
  }

  private createAdapterFromFactory(name: string): BaseProviderAdapter | undefined {
    const factory = this.adapterFactories.get(name);
    if (!factory) {
      return undefined;
    }

    try {
      const adapter = factory();
      this.adapters.set(name, adapter);
      
      this.logger.debug('Provider adapter created from factory', {
        metadata: { providerName: name }
      });
      
      return adapter;
    } catch (error) {
      this.logger.warn('Failed to create adapter from factory', {
        metadata: { 
          providerName: name,
          error: (error as Error).message
        }
      });
      return undefined;
    }
  }

  private getSourceAdapter(name: string): BaseProviderAdapter | undefined {
    const factory = this.adapterFactories.get(name);
    if (factory) {
      try {
        return factory();
      } catch (error) {
        this.logger.warn('Failed to create source adapter from factory', {
          metadata: { providerName: name }
        });
      }
    }

    return this.adapters.get(name);
  }

  private attemptAdapterCreation(
    sourceAdapter: BaseProviderAdapter,
    name: string,
    options: AdapterCreationOptions
  ): BaseProviderAdapter | undefined {
    const AdapterClass = sourceAdapter.constructor as AdapterConstructor;
    const modelMapping = options.subProvider?.toDocument?.()?.model_mapping || {};

    const adapter = this.tryCreateAdapter(AdapterClass, options.apiKey, modelMapping) ||
                   this.tryCreateAdapterSimple(AdapterClass, options.apiKey);

    if (!adapter) {
      this.logger.warn('Failed to create adapter with custom API key', {
        metadata: { providerName: name }
      });
      return undefined;
    }

    this.logger.debug('Provider adapter created with custom API key', {
      metadata: { providerName: name }
    });

    return adapter;
  }

  private tryCreateAdapter(
    AdapterClass: AdapterConstructor,
    apiKey: string,
    modelMapping: any
  ): BaseProviderAdapter | undefined {
    try {
      return new AdapterClass(apiKey, this.logger, modelMapping);
    } catch (error) {
      this.logger.warn('Failed to create adapter with full parameters', {
        metadata: { error: (error as Error).message }
      });
      return undefined;
    }
  }

  private tryCreateAdapterSimple(
    AdapterClass: AdapterConstructor,
    apiKey: string
  ): BaseProviderAdapter | undefined {
    try {
      return new AdapterClass(apiKey, this.logger);
    } catch (error) {
      this.logger.warn('Failed to create adapter with simple parameters', {
        metadata: { error: (error as Error).message }
      });
      return undefined;
    }
  }

  private findAdapterInCollection(
    adapters: IterableIterator<BaseProviderAdapter>,
    model: string
  ): BaseProviderAdapter | undefined {
    for (const adapter of adapters) {
      if (adapter.supportsModel(model)) {
        return adapter;
      }
    }
    return undefined;
  }

  private findAdapterInFactories(model: string): BaseProviderAdapter | undefined {
    for (const [name, factory] of this.adapterFactories) {
      if (this.adapters.has(name)) {
        continue;
      }

      try {
        const adapter = factory();
        if (adapter.supportsModel(model)) {
          this.adapters.set(name, adapter);
          return adapter;
        }
      } catch (error) {
        this.logger.warn('Failed to create adapter from factory during model search', {
          metadata: { providerName: name }
        });
      }
    }
    return undefined;
  }

  private addMatchingAdapters(
    adapters: IterableIterator<BaseProviderAdapter>,
    model: string,
    results: BaseProviderAdapter[]
  ): void {
    for (const adapter of adapters) {
      if (adapter.supportsModel(model)) {
        results.push(adapter);
      }
    }
  }

  private addMatchingFactoryAdapters(model: string, results: BaseProviderAdapter[]): void {
    for (const [name, factory] of this.adapterFactories) {
      if (this.adapters.has(name)) {
        continue;
      }

      try {
        const adapter = factory();
        if (adapter.supportsModel(model)) {
          this.adapters.set(name, adapter);
          results.push(adapter);
        }
      } catch (error) {
        this.logger.warn('Failed to create adapter from factory during multi-adapter search', {
          metadata: { providerName: name }
        });
      }
    }
  }

  private getAllAdapters(): BaseProviderAdapter[] {
    const instantiatedAdapters = Array.from(this.adapters.values());
    const allAdapters = [...instantiatedAdapters];

    for (const [name, factory] of this.adapterFactories) {
      if (this.adapters.has(name)) {
        continue;
      }

      try {
        const adapter = factory();
        allAdapters.push(adapter);
      } catch (error) {
        this.logger.warn('Failed to create adapter from factory during stats calculation', {
          metadata: { providerName: name }
        });
      }
    }

    return allAdapters;
  }

  private calculateTotalModels(adapters: BaseProviderAdapter[]): number {
    const allModels = new Set<string>();
    
    for (const adapter of adapters) {
      for (const model of adapter.supportedModels) {
        allModels.add(model);
      }
    }

    return allModels.size;
  }

  private calculateCapabilityStats(adapters: BaseProviderAdapter[]): Record<string, number> {
    const stats: Record<string, number> = {};

    for (const capability of ProviderRegistry.SUPPORTED_CAPABILITIES) {
      stats[capability] = 0;
    }

    for (const adapter of adapters) {
      for (const capability of ProviderRegistry.SUPPORTED_CAPABILITIES) {
        if (adapter.supportsCapability(capability)) {
          stats[capability]++;
        }
      }
    }

    return stats;
  }
}
