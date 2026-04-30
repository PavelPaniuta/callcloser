import { Injectable } from "@nestjs/common";
import { prisma } from "@crm/db";

@Injectable()
export class CompaniesService {
  list() {
    return prisma.company.findMany({ orderBy: { name: "asc" } });
  }

  create(data: { name: string }) {
    return prisma.company.create({ data });
  }
}
