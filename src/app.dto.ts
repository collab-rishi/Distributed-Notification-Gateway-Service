// src/app.dto.ts

import { IsDateString, IsBoolean, IsEmail, IsEnum, IsNotEmpty, IsString, IsUUID, IsNumber, IsOptional, IsObject, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';


export interface PaginationMeta {
    total: number;
    limit: number;
    page: number;
    total_pages: number;
    has_next: boolean;
    has_previous: boolean;
}

export enum NotificationType {
    EMAIL = 'email',
    PUSH = 'push',
}

export enum NotificationStatus {
    DELIVERED = "delivered",
    PENDING = "pending",
    FAILED = "failed",
}


export class UserDataDto {
    @IsString()
    @IsNotEmpty()
    readonly name: string;
    
    // Using IsString for HttpUrl validation for simplicity
    @IsString() 
    @IsNotEmpty()
    readonly link: string; 

    @IsObject()
    @IsOptional()
    readonly meta?: Record<string, any>;
}


export class SendNotificationDto {
    
    
    @IsEnum(NotificationType) 
    @IsNotEmpty()
    readonly notification_type: NotificationType; 

    
    @IsUUID() 
    @IsNotEmpty()
    readonly user_id: string; 

    
    @IsString()
    @IsNotEmpty()
    readonly template_code: string; 

    
    @ValidateNested()
    @Type(() => UserDataDto)
    @IsNotEmpty()
    readonly variables: UserDataDto; 

   
    @IsString()
    @IsNotEmpty()
    readonly request_id: string; 

    
    @IsNumber()
    @IsNotEmpty()
    readonly priority: number;

    @IsOptional()
    @IsObject()
    readonly metadata?: Record<string, any>;
}


export class UserPreferenceDto {
    @IsBoolean()
    readonly email: boolean;

    @IsBoolean()
    readonly push: boolean;
}


export class CreateUserDto {
    @IsString()
    @IsNotEmpty()
    readonly name: string;

    
    @IsEmail()
    @IsNotEmpty()
    readonly email: string;
    
    
    @IsOptional()
    @IsString()
    readonly push_token?: string; 
    
    
    @ValidateNested()
    @Type(() => UserPreferenceDto)
    readonly preferences: UserPreferenceDto;

    @IsString()
    @IsNotEmpty()
    readonly password: string; 
}

export class ReportStatusDto {
    @IsString()
    @IsNotEmpty()
    readonly notification_id: string; 

    @IsEnum(NotificationStatus)
    @IsNotEmpty()
    readonly status: NotificationStatus;
    
    
    @IsOptional()
    @IsDateString()
    readonly timestamp?: string;

    @IsOptional()
    @IsString()
    readonly error?: string;

    @IsOptional()
    @IsObject() 
    readonly meta?: Record<string, any>; 
}