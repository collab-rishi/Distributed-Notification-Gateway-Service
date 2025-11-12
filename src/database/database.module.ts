import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';

// Use @Global() to make PrismaService available everywhere without repeated imports
@Global() 
@Module({
  providers: [PrismaService],
  exports: [PrismaService], // Make it injectable by other modules
})
export class DatabaseModule {}