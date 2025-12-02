import type { Context, Next } from 'hono';

export class SnakeCaseMiddleware {
  private static readonly CAMEL_TO_SNAKE_REGEX = /([A-Z])/g;
  private static readonly LEADING_UNDERSCORE_REGEX = /^_/;

  public readonly handle = async (c: Context, next: Next): Promise<void> => {
    this.interceptJsonMethod(c);
    await next();
  };

  private interceptJsonMethod(c: Context): void {
    const originalJson = c.json.bind(c);
    
    c.json = (object: any, init?: any) => {
      const transformedObject = this.transformKeysToSnakeCase(object);
      return originalJson(transformedObject, init);
    };
  }

  private transformKeysToSnakeCase(value: any): any {
    if (this.isPrimitive(value)) {
      return value;
    }

    if (Array.isArray(value)) {
      return this.transformArray(value);
    }

    if (this.isPlainObject(value)) {
      return this.transformObject(value);
    }

    return value;
  }

  private isPrimitive(value: any): boolean {
    return value === null || 
           value === undefined ||
           typeof value === 'string' || 
           typeof value === 'number' || 
           typeof value === 'boolean';
  }

  private isPlainObject(value: any): boolean {
    return typeof value === 'object' && 
           value !== null && 
           !Array.isArray(value) &&
           value.constructor === Object;
  }

  private transformArray(array: any[]): any[] {
    return array.map(item => this.transformKeysToSnakeCase(item));
  }

  private transformObject(obj: Record<string, any>): Record<string, any> {
    const transformed: Record<string, any> = {};
    
    for (const [key, value] of Object.entries(obj)) {
      const snakeKey = this.convertToSnakeCase(key);
      transformed[snakeKey] = this.transformKeysToSnakeCase(value);
    }
    
    return transformed;
  }

  private convertToSnakeCase(str: string): string {
    return str
      .replace(SnakeCaseMiddleware.CAMEL_TO_SNAKE_REGEX, '_$1')
      .toLowerCase()
      .replace(SnakeCaseMiddleware.LEADING_UNDERSCORE_REGEX, '');
  }
}