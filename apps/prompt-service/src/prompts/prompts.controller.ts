import { Body, Controller, Get, Param, Post } from "@nestjs/common";
import { IsString } from "class-validator";
import { PromptsService } from "./prompts.service";

class CreatePromptDto {
  @IsString()
  name!: string;

  @IsString()
  systemPrompt!: string;
}

@Controller("prompts")
export class PromptsController {
  constructor(private readonly prompts: PromptsService) {}

  @Get()
  list() {
    return this.prompts.list();
  }

  @Get("active")
  active() {
    return this.prompts.getActive();
  }

  @Get(":id")
  get(@Param("id") id: string) {
    return this.prompts.get(id);
  }

  @Post()
  create(@Body() body: CreatePromptDto) {
    return this.prompts.create(body);
  }

  @Post(":id/publish")
  publish(@Param("id") id: string) {
    return this.prompts.publish(id);
  }
}
