export interface KernelModule {
  name: string;
  version: string;
  dependencies?: string[];
  initialize(): Promise<void>;
  shutdown(): Promise<void>;
  getHealth(): ModuleHealth;
}

export interface ModuleHealth {
  status: 'healthy' | 'degraded' | 'unhealthy';
  lastCheck: number;
  details?: Record<string, any>;
}

export interface ServiceRegistration<T = any> {
  name: string;
  factory: () => T;
  dependencies?: string[];
}

export interface KernelConfiguration {
  environment: 'development' | 'production' | 'test';
  logLevel: 'error' | 'warn' | 'info' | 'debug';
  gracefulShutdownTimeout: number;
}

export interface KernelContext {
  requestId?: string;
  userId?: string;
  metadata?: Record<string, any>;
}

export type ServiceFactory<T> = (kernel: IKernel) => T;
export type AsyncServiceFactory<T> = (kernel: IKernel) => Promise<T>;

export interface IKernel {
  get<T>(name: string): T;
  getAsync<T>(name: string): Promise<T>;
  register<T>(name: string, factory: ServiceFactory<T>, options?: { singleton?: boolean }): void;
  registerAsync<T>(name: string, factory: AsyncServiceFactory<T>, options?: { singleton?: boolean }): void;
  has(name: string): boolean;
  getModule(name: string): KernelModule | undefined;
  registerModule(module: KernelModule): void;
  initialize(): Promise<void>;
  shutdown(): Promise<void>;
  getHealth(): Promise<Record<string, ModuleHealth>>;
}

export interface IServiceRegistry {
  register<T>(name: string, factory: ServiceFactory<T>, singleton?: boolean): void;
  registerAsync<T>(name: string, factory: AsyncServiceFactory<T>, singleton?: boolean): void;
  get<T>(name: string): T;
  getAsync<T>(name: string): Promise<T>;
  has(name: string): boolean;
  clear(): void;
}