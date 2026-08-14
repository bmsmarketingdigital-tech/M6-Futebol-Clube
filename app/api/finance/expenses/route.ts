import { getDb } from "../../../../db";
import { getPostgresClient, postgresConfigured } from "../../../../db/postgres";
import { expenses } from "../../../../db/schema";
import { getApiContext } from "../../api-auth";
import { dueDateForMonth, parseMoneyToCents, validateMonth } from "../finance-utils";

export const dynamic = "force-dynamic";

const methods = new Set(["cash", "pix", "card", "bank", "other"]);
const categories = new Set([
  "Pessoal",
  "Aluguel",
  "Materiais",
  "Manutenção",
  "Transporte",
  "Marketing",
  "Impostos e taxas",
  "Água, luz e internet",
  "Outros",
]);

type PaymentMethod = "cash" | "pix" | "card" | "bank" | "other";

type ExpenseInsertValue = {
  id: string;
  organizationId: string;
  referenceMonth: string;
  description: string;
  category: string;
  supplier: string | null;
  amountCents: number;
  dueDate: string;
  paidAt: Date | null;
  paymentMethod: PaymentMethod | null;
  status: "open" | "paid" | "overdue";
  notes: string | null;
  installmentGroupId: string | null;
  installmentNumber: number;
  installmentCount: number;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
};

type PostgresExpenseRow = {
  id: string;
  organization_id: string;
  reference_month: string;
  description: string;
  category: string;
  supplier: string | null;
  amount_cents: number;
  due_date: string;
  paid_at: number | null;
  payment_method: PaymentMethod | null;
  status: "open" | "paid" | "overdue" | "cancelled";
  notes: string | null;
  installment_group_id: string | null;
  installment_number: number;
  installment_count: number;
  created_by: string;
  created_at: number;
  updated_at: number;
};

function expenseToDto(row: PostgresExpenseRow) {
  return {
    id: row.id,
    organizationId: row.organization_id,
    referenceMonth: row.reference_month,
    description: row.description,
    category: row.category,
    supplier: row.supplier,
    amountCents: row.amount_cents,
    dueDate: row.due_date,
    paidAt: row.paid_at ? new Date(row.paid_at * 1000).toISOString() : null,
    paymentMethod: row.payment_method,
    status: row.status,
    notes: row.notes,
    installmentGroupId: row.installment_group_id,
    installmentNumber: row.installment_number,
    installmentCount: row.installment_count,
    createdBy: row.created_by,
    createdAt: new Date(row.created_at * 1000),
    updatedAt: new Date(row.updated_at * 1000),
  };
}

function validDate(value: string | undefined) {
  if (!value || !/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(value)) {
    return false;
  }
  return new Date(`${value}T12:00:00Z`).toISOString().slice(0, 10) === value;
}

function addMonths(month: string, offset: number) {
  const [year, monthNumber] = month.split("-").map(Number);
  const date = new Date(Date.UTC(year, monthNumber - 1 + offset, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

export async function POST(request: Request) {
  try {
    const context = await getApiContext(request);
    if (!context) {
      return Response.json({ error: "Acesso não autorizado." }, { status: 401 });
    }

    const payload = (await request.json()) as {
      referenceMonth?: string;
      description?: string;
      category?: string;
      supplier?: string;
      amount?: unknown;
      dueDate?: string;
      paid?: boolean;
      paymentMethod?: string;
      notes?: string;
      installments?: number;
    };
    const referenceMonth = validateMonth(payload.referenceMonth);
    const description = payload.description?.trim() ?? "";
    const category = payload.category?.trim() ?? "";
    const supplier = payload.supplier?.trim().slice(0, 120) || null;
    const amountCents = parseMoneyToCents(payload.amount);
    const dueDate = payload.dueDate ?? "";
    const notes = payload.notes?.trim().slice(0, 500) || null;
    const paid = payload.paid === true;
    const paymentMethod = paid ? payload.paymentMethod ?? "pix" : null;
    const installmentCount = Number(payload.installments ?? 1);

    if (!referenceMonth || description.length < 2 || description.length > 140) {
      return Response.json(
        { error: "Informe competência e descrição válidas." },
        { status: 400 },
      );
    }
    if (!categories.has(category)) {
      return Response.json({ error: "Categoria de despesa inválida." }, { status: 400 });
    }
    if (amountCents === null || amountCents <= 0) {
      return Response.json({ error: "Informe um valor maior que zero." }, { status: 400 });
    }
    if (
      !Number.isInteger(installmentCount) ||
      installmentCount < 1 ||
      installmentCount > 60 ||
      amountCents < installmentCount
    ) {
      return Response.json(
        { error: "Informe entre 1 e 60 parcelas, com valor mínimo de R$ 0,01 por parcela." },
        { status: 400 },
      );
    }
    if (!validDate(dueDate)) {
      return Response.json({ error: "Informe uma data de vencimento válida." }, { status: 400 });
    }
    if (paid && installmentCount > 1) {
      return Response.json(
        { error: "Dê baixa em cada parcela conforme ela for paga." },
        { status: 400 },
      );
    }
    if (paid && !methods.has(paymentMethod ?? "")) {
      return Response.json({ error: "Forma de pagamento inválida." }, { status: 400 });
    }

    const now = new Date();
    const installmentGroupId = installmentCount > 1 ? crypto.randomUUID() : null;
    const baseAmountCents = Math.floor(amountCents / installmentCount);
    const remainderCents = amountCents % installmentCount;
    const firstDueDay = Number(dueDate.slice(8, 10));
    const values: ExpenseInsertValue[] = Array.from({ length: installmentCount }, (_, index) => {
      const installmentDueMonth = addMonths(dueDate.slice(0, 7), index);
      const installmentDueDate = dueDateForMonth(installmentDueMonth, firstDueDay);
      const installmentReferenceMonth = addMonths(referenceMonth, index);
      const status = paid
        ? "paid" as const
        : installmentDueDate < now.toISOString().slice(0, 10)
          ? "overdue" as const
          : "open" as const;
      return {
        id: crypto.randomUUID(),
        organizationId: context.membership.organizationId,
        referenceMonth: installmentReferenceMonth,
        description,
        category,
        supplier,
        amountCents: baseAmountCents + (index < remainderCents ? 1 : 0),
        dueDate: installmentDueDate,
        paidAt: paid ? now : null,
        paymentMethod: paid ? (paymentMethod as PaymentMethod) : null,
        status,
        notes,
        installmentGroupId,
        installmentNumber: index + 1,
        installmentCount,
        createdBy: context.user.email,
        createdAt: now,
        updatedAt: now,
      };
    });

    if (postgresConfigured()) {
      const sql = getPostgresClient();
      const createdExpenses = await sql.begin(async (transaction) => {
        const rows: PostgresExpenseRow[] = [];
        for (const value of values) {
          const paidAt = value.paidAt ? Math.floor(value.paidAt.getTime() / 1000) : null;
          const createdAt = Math.floor(value.createdAt.getTime() / 1000);
          const updatedAt = Math.floor(value.updatedAt.getTime() / 1000);
          const [row] = await transaction<PostgresExpenseRow[]>`
            INSERT INTO expenses (
              id, organization_id, reference_month, description, category,
              supplier, amount_cents, due_date, paid_at, payment_method,
              status, notes, installment_group_id, installment_number,
              installment_count, created_by, created_at, updated_at
            )
            VALUES (
              ${value.id}, ${value.organizationId}, ${value.referenceMonth},
              ${value.description}, ${value.category}, ${value.supplier},
              ${value.amountCents}, ${value.dueDate}, ${paidAt},
              ${value.paymentMethod}, ${value.status}, ${value.notes},
              ${value.installmentGroupId}, ${value.installmentNumber},
              ${value.installmentCount}, ${value.createdBy}, ${createdAt},
              ${updatedAt}
            )
            RETURNING id, organization_id, reference_month, description,
                      category, supplier, amount_cents, due_date, paid_at,
                      payment_method, status, notes, installment_group_id,
                      installment_number, installment_count, created_by,
                      created_at, updated_at
          `;
          rows.push(row);
        }
        return rows;
      });
      const dtos = createdExpenses.map(expenseToDto);
      return Response.json({ expense: dtos[0], expenses: dtos }, { status: 201 });
    }

    const createdExpenses = await getDb()
      .insert(expenses)
      .values(values)
      .returning();

    return Response.json(
      { expense: createdExpenses[0], expenses: createdExpenses },
      { status: 201 },
    );
  } catch (error) {
    console.error("Failed to create expense", error);
    return Response.json(
      { error: "Não foi possível lançar a despesa." },
      { status: 500 },
    );
  }
}
