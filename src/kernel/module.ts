import type { KernelModule, ModuleHealth, IKernel } from './types';

export abstract class BaseModule implements KernelModule {
  protected kernel!: IKernel;
  protected health: ModuleHealth = {
    status: 'healthy',
    lastCheck: Date.now()
  };

  constructor(
    public readonly name: string,
    public readonly version: string,
    public readonly dependencies: string[] = []
  ) {}

  setKernel(kernel: IKernel): void {
    this.kernel = kernel;
  }

  abstract initialize(): Promise<void>;
  abstract shutdown(): Promise<void>;

  getHealth(): ModuleHealth {
    this.health.lastCheck = Date.now();
    return { ...this.health };
  }

  protected updateHealth(status: ModuleHealth['status'], details?: Record<string, any>): void {
    this.health = {
      status,
      lastCheck: Date.now(),
      details
    };
  }

  protected async validateDependencies(): Promise<void> {
    for (const dep of this.dependencies) {
      if (!this.kernel.has(dep)) {
        throw new Error(`Module '${this.name}' depends on '${dep}' but it's not available`);
      }
    }
  }

  protected createModuleLogger(context?: string): any {
    const logger = this.kernel.get<any>('Logger');
    return logger.createChild(`${this.name}${context ? `:${context}` : ''}`);
  }
}