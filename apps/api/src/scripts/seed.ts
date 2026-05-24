import { PrismaClient, UsageMetric } from "@prisma/client";
import { currentMonthlyPeriod } from "../utils/period.js";
import { hashPassword } from "../utils/password.js";

const prisma = new PrismaClient();

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();

  if (!value) {
    throw new Error(`${name} is required for bootstrap seeding`);
  }

  return value;
}

async function main(): Promise<void> {
  const email = requireEnv("BOOTSTRAP_SUPER_ADMIN_EMAIL").toLowerCase();
  const password = requireEnv("BOOTSTRAP_SUPER_ADMIN_PASSWORD");
  const name = process.env.BOOTSTRAP_SUPER_ADMIN_NAME?.trim() || "Platform Admin";
  const companyName = process.env.BOOTSTRAP_COMPANY_NAME?.trim() || "VoxLink Platform";
  const companySlug = process.env.BOOTSTRAP_COMPANY_SLUG?.trim() || "voxlink-platform";
  const resetExistingPassword = process.env.BOOTSTRAP_SUPER_ADMIN_RESET_PASSWORD === "true";

  if (password.length < 12) {
    throw new Error("BOOTSTRAP_SUPER_ADMIN_PASSWORD must be at least 12 characters");
  }

  const passwordHash = await hashPassword(password);
  const { periodStart, periodEnd } = currentMonthlyPeriod();

  const result = await prisma.$transaction(async (tx) => {
    const company = await tx.company.upsert({
      where: { slug: companySlug },
      update: {
        name: companyName,
        status: "active"
      },
      create: {
        name: companyName,
        slug: companySlug,
        status: "active"
      }
    });

    const existingUser = await tx.user.findUnique({
      where: { email },
      select: { id: true }
    });

    const user = existingUser
      ? await tx.user.update({
          where: { id: existingUser.id },
          data: {
            name,
            emailVerifiedAt: new Date(),
            ...(resetExistingPassword ? { passwordHash } : {})
          }
        })
      : await tx.user.create({
          data: {
            email,
            name,
            passwordHash,
            emailVerifiedAt: new Date()
          }
        });

    await tx.companyMembership.upsert({
      where: {
        userId_companyId: {
          userId: user.id,
          companyId: company.id
        }
      },
      update: {
        role: "super_admin"
      },
      create: {
        userId: user.id,
        companyId: company.id,
        role: "super_admin"
      }
    });

    const existingSubscription = await tx.subscription.findFirst({
      where: { companyId: company.id },
      select: { id: true }
    });

    if (existingSubscription) {
      await tx.subscription.update({
        where: { id: existingSubscription.id },
        data: {
          status: "active",
          planCode: "starter"
        }
      });
    } else {
      await tx.subscription.create({
        data: {
          companyId: company.id,
          status: "active",
          planCode: "starter",
          currentPeriodStart: periodStart,
          currentPeriodEnd: periodEnd
        }
      });
    }

    await tx.usageTracking.createMany({
      data: Object.values(UsageMetric).map((metric) => ({
        companyId: company.id,
        metric,
        amount: 0,
        periodStart,
        periodEnd
      })),
      skipDuplicates: true
    });

    return {
      companyId: company.id,
      userId: user.id,
      createdUser: !existingUser,
      resetExistingPassword
    };
  });

  console.info(
    JSON.stringify(
      {
        message: "Bootstrap seed completed",
        ...result
      },
      null,
      2
    )
  );
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
