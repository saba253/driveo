"use client";

import { useActionState } from "react";
import { signInAction, type FormState } from "@/app/admin/actions";
import { Button } from "@/components/ui/Button";
import { Field, Input } from "@/components/ui/Field";
import { ka } from "@/content/ka";
import { FormMessage } from "./AdminCard";

const t = ka.admin.login;

export function LoginForm() {
  const [state, action, pending] = useActionState<FormState, FormData>(signInAction, { error: null });
  return (
    <form action={action} className="grid gap-5" noValidate>
      <FormMessage>{state.error}</FormMessage>
      <Field label={t.email} htmlFor="admin-email">
        <Input id="admin-email" name="email" type="email" autoComplete="username" required maxLength={254} />
      </Field>
      <Field label={t.password} htmlFor="admin-password">
        <Input id="admin-password" name="password" type="password" autoComplete="current-password" required maxLength={200} />
      </Field>
      <Button type="submit" size="lg" disabled={pending}>
        {pending ? t.pending : t.submit}
      </Button>
    </form>
  );
}
