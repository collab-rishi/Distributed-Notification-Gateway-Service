import { Injectable, CanActivate, ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config'; 

@Injectable()
export class ApiKeyAuthGuard implements CanActivate {
  
 
  constructor(private readonly configService: ConfigService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    
    
    const validApiKey = this.configService.get<string>('API_KEY_SECRET'); 
    
    
    if (!validApiKey) {
        throw new Error('API_KEY_SECRET is not configured.');
    }

    const apiKey = request.headers['x-api-key'];

    if (!apiKey) {
      throw new UnauthorizedException('API Key missing. Please provide the x-api-key header.');
    }

   
    if (apiKey !== validApiKey) {
      throw new UnauthorizedException('Invalid API Key provided.');
    }

    return true;
  }
}