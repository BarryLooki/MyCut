import { useState, type ComponentProps, type FormEvent } from "react"
import { Icon } from "@iconify/react"
import restartCircleLinear from "@iconify-icons/solar/restart-circle-linear"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"

export type LoginMode = "signin" | "signup"

interface LoginFormProps
  extends Omit<ComponentProps<"form">, "onSubmit"> {
  mode: LoginMode
  submitting: boolean
  error?: string | null
  onModeChange: (mode: LoginMode) => void
  onSubmitCredentials: (email: string, password: string) => Promise<void>
}

export function LoginForm({
  className,
  mode,
  submitting,
  error,
  onModeChange,
  onSubmitCredentials,
  ...props
}: LoginFormProps) {
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [validationError, setValidationError] = useState<string | null>(null)

  const isSignIn = mode === "signin"

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    const normalizedEmail = email.trim()
    if (!normalizedEmail || !password) {
      setValidationError("请输入邮箱和密码")
      return
    }
    if (!/^\S+@\S+\.\S+$/.test(normalizedEmail)) {
      setValidationError("请输入有效的邮箱地址")
      return
    }
    if (!isSignIn && password.length < 6) {
      setValidationError("密码至少需要 6 位")
      return
    }

    setValidationError(null)
    await onSubmitCredentials(normalizedEmail, password)
  }

  const switchMode = () => {
    setValidationError(null)
    onModeChange(isSignIn ? "signup" : "signin")
  }

  return (
    <form
      className={cn("flex flex-col gap-6", className)}
      onSubmit={handleSubmit}
      noValidate
      {...props}
    >
      <FieldGroup>
        <div className="flex flex-col items-center gap-1 text-center">
          <h1 className="text-2xl font-bold">
            {isSignIn ? "登录你的账号" : "创建你的账号"}
          </h1>
          <p className="text-balance text-sm text-muted-foreground">
            {isSignIn
              ? "输入邮箱和密码以继续使用 MyCut"
              : "输入邮箱和密码以创建 MyCut 账号"}
          </p>
        </div>

        <FieldGroup className="gap-4">
          <Field>
            <FieldLabel htmlFor="email">邮箱</FieldLabel>
            <Input
              id="email"
              name="email"
              type="email"
              inputMode="email"
              autoComplete="email"
              placeholder="m@example.com"
              value={email}
              aria-invalid={Boolean(validationError || error)}
              onChange={(event) => {
                setEmail(event.target.value)
                setValidationError(null)
              }}
              disabled={submitting}
              required
            />
          </Field>

          <Field>
            <FieldLabel htmlFor="password">密码</FieldLabel>
            <Input
              id="password"
              name="password"
              type="password"
              autoComplete={isSignIn ? "current-password" : "new-password"}
              placeholder={isSignIn ? undefined : "至少 6 位"}
              value={password}
              aria-invalid={Boolean(validationError || error)}
              onChange={(event) => {
                setPassword(event.target.value)
                setValidationError(null)
              }}
              disabled={submitting}
              required
            />
          </Field>

          {(validationError || error) && (
            <FieldError aria-live="polite">
              {validationError || error}
            </FieldError>
          )}
        </FieldGroup>

        <Field>
          <Button type="submit" disabled={submitting}>
            {submitting && <Icon icon={restartCircleLinear} className="size-4 animate-spin text-white" />}
            {submitting
              ? isSignIn
                ? "正在登录"
                : "正在创建"
              : isSignIn
                ? "登录"
                : "创建账号"}
          </Button>
          <FieldDescription className="text-center">
            {isSignIn ? "还没有账号？" : "已经有账号？"}
            <button
              type="button"
              className="ml-1 underline underline-offset-4"
              onClick={switchMode}
              disabled={submitting}
            >
              {isSignIn ? "创建账号" : "返回登录"}
            </button>
          </FieldDescription>
        </Field>
      </FieldGroup>
    </form>
  )
}
