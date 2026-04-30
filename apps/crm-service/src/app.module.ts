import { Module } from "@nestjs/common";
import { ContactsModule } from "./contacts/contacts.module";
import { CompaniesModule } from "./companies/companies.module";
import { HealthController } from "./health.controller";

@Module({
  imports: [ContactsModule, CompaniesModule],
  controllers: [HealthController],
})
export class AppModule {}
