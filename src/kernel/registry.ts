import type { IServiceRegistry, ServiceFactory, AsyncServiceFactory, IKernel } from './types';

interface ServiceDefinition {
  factory: ServiceFactory<any> | AsyncServiceFactory<any>;
  instance?: any;
  isAsync: boolean;
}

export class ServiceRegistry implements IServiceRegistry {
  private services: Map<string, ServiceDefinition>;
  private instances: Map<string, any>;
  private kernel: IKernel;
  
  constructor(kernel: IKernel) {
    this.kernel = kernel;
    this.services = new Map<string, ServiceDefinition>();
    this.instances = new Map<string, any>();
  }

  register<T>(name: string, factory: ServiceFactory<T>): void {
    this.validateServiceName(name);
    
    this.services.set(name, {
      factory,
      isAsync: false
    });
  }

  registerAsync<T>(name: string, factory: AsyncServiceFactory<T>): void {
    this.validateServiceName(name);
    
    this.services.set(name, {
      factory,
      isAsync: true
    });
  }

  get<T>(name: string): T {
    const service = this.getServiceDefinition(name);
    this.validateSyncService(name, service);
    return this.createSyncInstance<T>(service);
  }

  async getAsync<T>(name: string): Promise<T> {
    if (this.instances.has(name)) {
      return this.instances.get(name);
    }

    const service = this.getServiceDefinition(name);
    const instance = await this.createAsyncInstance<T>(service);
    
    this.instances.set(name, instance);
    return instance;
  }

  has(name: string): boolean {
    return this.services.has(name);
  }

  clear(): void {
    this.services.clear();
    this.instances.clear();
  }

  getAllServiceNames(): string[] {
    return Array.from(this.services.keys());
  }

  getServiceCount(): number {
    return this.services.size;
  }

  getInstanceCount(): number {
    return this.instances.size;
  }

  private validateServiceName(name: string): void {
    if (!name || typeof name !== 'string') {
      throw new Error('Service name must be a non-empty string');
    }
  }

  private getServiceDefinition(name: string): ServiceDefinition {
    const service = this.services.get(name);
    if (!service) {
      throw new Error(`Service '${name}' not registered`);
    }
    return service;
  }

  private validateSyncService(name: string, service: ServiceDefinition): void {
    if (service.isAsync) {
      throw new Error(`Service '${name}' is async, use getAsync instead`);
    }
  }

  private createSyncInstance<T>(service: ServiceDefinition): T {
    return (service.factory as ServiceFactory<T>)(this.kernel);
  }

  private async createAsyncInstance<T>(service: ServiceDefinition): Promise<T> {
    return service.isAsync 
      ? await (service.factory as AsyncServiceFactory<T>)(this.kernel)
      : (service.factory as ServiceFactory<T>)(this.kernel);
  }
}
