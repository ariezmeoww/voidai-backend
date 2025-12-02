import type { 
  IKernel, 
  KernelModule, 
  ModuleHealth, 
  KernelConfiguration, 
  ServiceFactory, 
  AsyncServiceFactory 
} from './types';
import { ServiceRegistry } from './registry';

interface KernelStats {
  moduleCount: number;
  serviceCount: number;
  instanceCount: number;
  isInitialized: boolean;
}

export class Kernel implements IKernel {
  private static readonly SHUTDOWN_TIMEOUT_DEFAULT = 30000;
  private static readonly GRACEFUL_SHUTDOWN_SIGNALS: NodeJS.Signals[] = ['SIGTERM', 'SIGINT'];

  private registry: ServiceRegistry;
  private modules: Map<string, KernelModule>;
  private isInitialized: boolean;
  private shutdownPromise?: Promise<void>;
  private config: KernelConfiguration;

  constructor(config: KernelConfiguration) {
    this.config = config;
    this.registry = new ServiceRegistry(this);
    this.modules = new Map<string, KernelModule>();
    this.isInitialized = false;
    this.registerCoreServices();
  }

  register<T>(name: string, factory: ServiceFactory<T>): void {
    this.registry.register(name, factory);
  }

  registerAsync<T>(name: string, factory: AsyncServiceFactory<T>): void {
    this.registry.registerAsync(name, factory);
  }

  get<T>(name: string): T {
    return this.registry.get<T>(name);
  }

  async getAsync<T>(name: string): Promise<T> {
    return this.registry.getAsync<T>(name);
  }

  has(name: string): boolean {
    return this.registry.has(name);
  }

  getModule(name: string): KernelModule | undefined {
    return this.modules.get(name);
  }

  registerModule(module: KernelModule): void {
    this.validateModuleRegistration(module);
    this.setModuleKernel(module);
    this.modules.set(module.name, module);
  }

  async initialize(): Promise<void> {
    if (this.isInitialized) {
      throw new Error('Kernel is already initialized');
    }

    try {
      await this.performInitialization();
    } catch (error) {
      console.error('Kernel initialization failed:', error);
      throw error;
    }
  }

  async shutdown(): Promise<void> {
    if (this.shutdownPromise) {
      return this.shutdownPromise;
    }

    this.shutdownPromise = this.performShutdown();
    return this.shutdownPromise;
  }

  async getHealth(): Promise<Record<string, ModuleHealth>> {
    const health: Record<string, ModuleHealth> = {};
    
    for (const [name, module] of this.modules) {
      health[name] = await this.getModuleHealth(module);
    }

    return health;
  }

  getConfiguration(): KernelConfiguration {
    return { ...this.config };
  }

  getStats(): KernelStats {
    return {
      moduleCount: this.modules.size,
      serviceCount: this.registry.getServiceCount(),
      instanceCount: this.registry.getInstanceCount(),
      isInitialized: this.isInitialized
    };
  }

  private registerCoreServices(): void {
    this.register('KernelConfig', () => this.config);
    this.register('Kernel', () => this);
  }

  private validateModuleRegistration(module: KernelModule): void {
    if (this.modules.has(module.name)) {
      throw new Error(`Module '${module.name}' is already registered`);
    }
  }

  private setModuleKernel(module: KernelModule): void {
    if ('setKernel' in module && typeof module.setKernel === 'function') {
      module.setKernel(this);
    }
  }

  private async performInitialization(): Promise<void> {
    const sortedModules = this.topologicalSortModules();
    
    await this.initializeModules(sortedModules);
    this.logInitializationStart();
    this.setupGracefulShutdown();
    this.isInitialized = true;
    this.logInitializationComplete(sortedModules);
  }

  private async initializeModules(modules: KernelModule[]): Promise<void> {
    for (const module of modules) {
      await module.initialize();
    }
  }

  private logInitializationStart(): void {
    const logger = this.get<any>('Logger');
    logger.info('Kernel initialization started', {
      metadata: {
        moduleCount: this.modules.size,
        serviceCount: this.registry.getServiceCount(),
        environment: this.config.environment
      }
    });
  }

  private logInitializationComplete(modules: KernelModule[]): void {
    const logger = this.get<any>('Logger');
    logger.info('Kernel initialization completed successfully', {
      metadata: {
        initializedModules: modules.map(m => m.name),
        totalServices: this.registry.getServiceCount()
      }
    });
  }

  private async performShutdown(): Promise<void> {
    const logger = this.get<any>('Logger');
    logger.info('Kernel shutdown initiated');

    const modules = Array.from(this.modules.values()).reverse();
    await this.shutdownModules(modules, logger);
    
    this.isInitialized = false;
    logger.info('Kernel shutdown completed');
  }

  private async shutdownModules(modules: KernelModule[], logger: any): Promise<void> {
    const shutdownPromises = modules.map(module => this.shutdownModule(module, logger));
    await Promise.allSettled(shutdownPromises);
  }

  private async shutdownModule(module: KernelModule, logger: any): Promise<void> {
    try {
      logger.debug(`Shutting down module: ${module.name}`);
      
      const timeoutMs = this.config.gracefulShutdownTimeout || Kernel.SHUTDOWN_TIMEOUT_DEFAULT;
      await Promise.race([
        module.shutdown(),
        this.createShutdownTimeout(module.name, timeoutMs)
      ]);
      
      logger.debug(`Module shut down: ${module.name}`);
    } catch (error) {
      logger.error(`Error shutting down module ${module.name}`, error as Error);
    }
  }

  private createShutdownTimeout(moduleName: string, timeoutMs: number): Promise<never> {
    return new Promise((_, reject) => 
      setTimeout(() => reject(new Error(`Module ${moduleName} shutdown timeout`)), timeoutMs)
    );
  }

  private async getModuleHealth(module: KernelModule): Promise<ModuleHealth> {
    try {
      return module.getHealth();
    } catch (error) {
      return {
        status: 'unhealthy',
        lastCheck: Date.now(),
        details: { error: (error as Error).message }
      };
    }
  }

  private topologicalSortModules(): KernelModule[] {
    const modules = Array.from(this.modules.values());
    const visited = new Set<string>();
    const visiting = new Set<string>();
    const sorted: KernelModule[] = [];

    const visit = (module: KernelModule) => {
      this.validateCircularDependency(module, visiting);
      
      if (visited.has(module.name)) {
        return;
      }

      visiting.add(module.name);
      this.visitDependencies(module, visit);
      
      visiting.delete(module.name);
      visited.add(module.name);
      sorted.push(module);
    };

    for (const module of modules) {
      if (!visited.has(module.name)) {
        visit(module);
      }
    }

    return sorted;
  }

  private validateCircularDependency(module: KernelModule, visiting: Set<string>): void {
    if (visiting.has(module.name)) {
      throw new Error(`Circular dependency detected involving module: ${module.name}`);
    }
  }

  private visitDependencies(module: KernelModule, visit: (module: KernelModule) => void): void {
    if (!module.dependencies) {
      return;
    }

    for (const depName of module.dependencies) {
      const depModule = this.modules.get(depName);
      if (depModule) {
        visit(depModule);
      }
    }
  }

  private setupGracefulShutdown(): void {
    this.setupSignalHandlers();
    this.setupErrorHandlers();
  }

  private setupSignalHandlers(): void {
    for (const signal of Kernel.GRACEFUL_SHUTDOWN_SIGNALS) {
      process.on(signal, async () => {
        await this.handleGracefulShutdown(signal);
      });
    }
  }

  private setupErrorHandlers(): void {
    process.on('uncaughtException', async (error) => {
      await this.handleUncaughtError('Uncaught exception', error);
    });

    process.on('unhandledRejection', async (reason) => {
      await this.handleUncaughtError('Unhandled rejection', reason as Error);
    });
  }

  private async handleGracefulShutdown(signal: string): Promise<void> {
    const logger = this.get<any>('Logger');
    logger.info(`Received ${signal}, initiating graceful shutdown`);
    
    try {
      await this.shutdown();
      process.exit(0);
    } catch (error) {
      logger.error('Error during graceful shutdown', error as Error);
      process.exit(1);
    }
  }

  private async handleUncaughtError(message: string, error: Error): Promise<void> {
    const logger = this.get<any>('Logger');
    logger.error(message, error);
    await this.shutdown();
    process.exit(1);
  }
}
