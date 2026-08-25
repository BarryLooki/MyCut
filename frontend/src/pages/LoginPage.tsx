import { lazy, Suspense, useState } from "react"
import { Icon } from "@iconify/react"
import moonLinear from "@iconify-icons/solar/moon-linear"
import sunLinear from "@iconify-icons/solar/sun-linear"
import { toast } from "sonner"

import logoDark from "@/assets/logo-dark.svg"
import logoLight from "@/assets/logo-light.svg"
import { LoginForm, type LoginMode } from "@/components/login-form"
import { Button } from "@/components/ui/button"
import { useAuth } from "@/context/AuthContext"
import { useTheme } from "@/context/ThemeContext"

const AuthRivePanel = lazy(() =>
  import("@/components/auth-rive-panel").then((module) => ({
    default: module.AuthRivePanel,
  }))
)

const LoginPage = () => {
  const { signIn, signUp } = useAuth()
  const { theme, toggleTheme } = useTheme()
  const [mode, setMode] = useState<LoginMode>("signin")
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = async (email: string, password: string) => {
    setSubmitting(true)
    setError(null)

    try {
      if (mode === "signin") {
        await signIn(email, password)
        toast.success("登录成功")
        return
      }

      const { needsEmailConfirm } = await signUp(email, password)
      if (needsEmailConfirm) {
        toast.success("账号已创建，请前往邮箱完成确认")
        setMode("signin")
      } else {
        toast.success("账号创建成功")
      }
    } catch (caughtError: unknown) {
      const raw =
        caughtError instanceof Error
          ? caughtError.message
          : "操作失败，请稍后重试"
      const friendly = /invalid login credentials/i.test(raw)
        ? "邮箱或密码不正确"
        : /user already registered/i.test(raw)
          ? "该邮箱已经注册，请直接登录"
          : /email not confirmed/i.test(raw)
            ? "邮箱尚未确认，请先完成邮箱验证"
            : raw
      setError(friendly)
    } finally {
      setSubmitting(false)
    }
  }

  const handleModeChange = (nextMode: LoginMode) => {
    setError(null)
    setMode(nextMode)
  }

  return (
    <div className="grid min-h-svh bg-background text-foreground lg:grid-cols-[minmax(0,1fr)_auto]">
      <section className="flex min-h-svh flex-col gap-4 p-6 md:p-10">
        <header className="flex items-center justify-between">
          <div className="flex items-center font-medium" aria-label="MyCut">
            <img
              src={logoLight}
              alt="MyCut"
              className="h-7 w-auto dark:hidden"
            />
            <img
              src={logoDark}
              alt="MyCut"
              className="hidden h-7 w-auto dark:block"
            />
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={toggleTheme}
            aria-label={theme === "dark" ? "切换到亮色模式" : "切换到暗色模式"}
          >
            <Icon icon={theme === "dark" ? sunLinear : moonLinear} className="size-4" />
          </Button>
        </header>

        <main className="flex flex-1 items-center justify-center" id="login-content">
          <div className="w-full max-w-xs">
            <LoginForm
              mode={mode}
              submitting={submitting}
              error={error}
              onModeChange={handleModeChange}
              onSubmitCredentials={handleSubmit}
            />
          </div>
        </main>

      </section>

      <aside className="relative hidden h-svh aspect-[48/71] bg-muted lg:block">
        <Suspense
          fallback={
            <div className="h-full w-full animate-pulse bg-muted" />
          }
        >
          <AuthRivePanel />
        </Suspense>
      </aside>
    </div>
  )
}

export default LoginPage
