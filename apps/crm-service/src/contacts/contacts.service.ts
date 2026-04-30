import { Injectable, NotFoundException } from "@nestjs/common";
import { prisma } from "@crm/db";

@Injectable()
export class ContactsService {
  async list() {
    return prisma.contact.findMany({
      orderBy: { updatedAt: "desc" },
      include: { company: true, _count: { select: { calls: true } } },
    });
  }

  async get(id: string) {
    const c = await prisma.contact.findUnique({
      where: { id },
      include: {
        company: true,
        activities: { orderBy: { createdAt: "desc" }, take: 50 },
        calls: {
          orderBy: { createdAt: "desc" },
          take: 30,
          include: { analytics: true, promptVersion: true },
        },
      },
    });
    if (!c) throw new NotFoundException("Contact not found");
    return c;
  }

  async findByPhone(phone: string) {
    return prisma.contact.findUnique({ where: { phone } });
  }

  async create(data: { phone: string; name?: string; companyId?: string }) {
    return prisma.contact.create({ data });
  }

  async upsertByPhone(phone: string, name?: string) {
    return prisma.contact.upsert({
      where: { phone },
      create: { phone, name },
      update: { ...(name ? { name } : {}) },
    });
  }

  async addActivity(contactId: string, type: string, metadata?: object) {
    return prisma.activity.create({
      data: { contactId, type, metadata: metadata as object | undefined },
    });
  }

  async delete(id: string) {
    const contact = await prisma.contact.findUnique({ where: { id } });
    if (!contact) throw new NotFoundException("Contact not found");
    await prisma.call.updateMany({
      where: { contactId: id },
      data: { contactId: null },
    });
    await prisma.contact.delete({ where: { id } });
    return { ok: true };
  }
}
