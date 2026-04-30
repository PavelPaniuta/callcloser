import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  let company = await prisma.company.findFirst();
  if (!company) {
    company = await prisma.company.create({ data: { name: "Demo Org" } });
  }

  await prisma.contact.upsert({
    where: { phone: "+15551234567" },
    create: {
      phone: "+15551234567",
      name: "Demo Client",
      companyId: company.id,
    },
    update: { name: "Demo Client", companyId: company.id },
  });

  const existing = await prisma.promptVersion.findFirst({
    where: { isActive: true },
  });
  if (!existing) {
    await prisma.promptVersion.create({
      data: {
        name: "default",
        systemPrompt:
          "You are a professional assistant. Keep answers under 3 sentences.",
        isActive: true,
        publishedAt: new Date(),
      },
    });
  }
}

main()
  .then(() => prisma.$disconnect())
  .catch((e) => {
    console.error(e);
    void prisma.$disconnect();
    process.exit(1);
  });
