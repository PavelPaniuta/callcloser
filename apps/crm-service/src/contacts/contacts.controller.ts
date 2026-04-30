import { Body, Controller, Delete, Get, Param, Post } from "@nestjs/common";
import { IsOptional, IsString, Matches } from "class-validator";
import { ContactsService } from "./contacts.service";

class CreateContactDto {
  @IsString()
  @Matches(/^\+?[0-9]{10,15}$/, { message: "Invalid phone" })
  phone!: string;

  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  companyId?: string;
}

@Controller("contacts")
export class ContactsController {
  constructor(private readonly contacts: ContactsService) {}

  @Get()
  list() {
    return this.contacts.list();
  }

  @Get(":id")
  get(@Param("id") id: string) {
    return this.contacts.get(id);
  }

  @Post()
  create(@Body() body: CreateContactDto) {
    return this.contacts.create(body);
  }

  @Post(":id/activities")
  addActivity(
    @Param("id") id: string,
    @Body() body: { type: string; metadata?: object },
  ) {
    return this.contacts.addActivity(id, body.type, body.metadata);
  }

  @Delete(":id")
  remove(@Param("id") id: string) {
    return this.contacts.delete(id);
  }
}
