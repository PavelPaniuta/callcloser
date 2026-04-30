import { Injectable, OnModuleInit } from "@nestjs/common";
import {
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

@Injectable()
export class S3Service implements OnModuleInit {
  private client!: S3Client;
  private bucket!: string;

  onModuleInit() {
    const endpoint = process.env.S3_ENDPOINT;
    const region = process.env.S3_REGION ?? "us-east-1";
    this.bucket = process.env.S3_BUCKET_RECORDINGS ?? "recordings";
    this.client = new S3Client({
      region,
      endpoint: endpoint || undefined,
      forcePathStyle: true,
      credentials: {
        accessKeyId: process.env.S3_ACCESS_KEY ?? "minio",
        secretAccessKey: process.env.S3_SECRET_KEY ?? "minio12345",
      },
    });
  }

  async putRecording(key: string, body: Buffer, contentType: string) {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
      }),
    );
    return key;
  }

  async getPresignedGetUrl(key: string, expiresSec = 3600) {
    const cmd = new GetObjectCommand({ Bucket: this.bucket, Key: key });
    return getSignedUrl(this.client, cmd, { expiresIn: expiresSec });
  }
}
