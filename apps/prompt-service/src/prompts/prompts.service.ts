import { Injectable, NotFoundException } from "@nestjs/common";
import { prisma } from "@crm/db";

@Injectable()
export class PromptsService {
  list() {
    return prisma.promptVersion.findMany({ orderBy: { createdAt: "desc" } });
  }

  async getActive() {
    const p = await prisma.promptVersion.findFirst({
      where: { isActive: true },
      orderBy: { publishedAt: "desc" },
    });
    if (!p) {
      return prisma.promptVersion.create({
        data: {
          name: "default",
          systemPrompt:
            "You are a professional call-center assistant. Be concise and polite.",
          isActive: true,
          publishedAt: new Date(),
        },
      });
    }
    return p;
  }

  async get(id: string) {
    const p = await prisma.promptVersion.findUnique({ where: { id } });
    if (!p) throw new NotFoundException();
    return p;
  }

  create(data: { name: string; systemPrompt: string }) {
    return prisma.promptVersion.create({ data: { ...data, isActive: false } });
  }

  async publish(id: string) {
    await prisma.promptVersion.updateMany({
      where: {},
      data: { isActive: false },
    });
    return prisma.promptVersion.update({
      where: { id },
      data: { isActive: true, publishedAt: new Date() },
    });
  }
}
