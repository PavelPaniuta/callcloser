import { Body, Controller, Get, Post } from "@nestjs/common";
import { IsString } from "class-validator";
import { CompaniesService } from "./companies.service";

class CreateCompanyDto {
  @IsString()
  name!: string;
}

@Controller("companies")
export class CompaniesController {
  constructor(private readonly companies: CompaniesService) {}

  @Get()
  list() {
    return this.companies.list();
  }

  @Post()
  create(@Body() body: CreateCompanyDto) {
    return this.companies.create(body);
  }
}
