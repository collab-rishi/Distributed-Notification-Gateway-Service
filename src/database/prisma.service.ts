import { INestApplication, Injectable, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit {

  // This lifecycle hook runs immediately after the module dependencies are resolved.
  async onModuleInit() {
    // Connect to the database when the module initializes
    await this.$connect(); 
    console.log('Prisma Client connected to database successfully.');
  }

  // This is a shutdown hook, optional but good practice for graceful exit
  async enableShutdownHooks(app: INestApplication) {
    process.on('beforeExit', () => {
      app.close();
    });
  }
}