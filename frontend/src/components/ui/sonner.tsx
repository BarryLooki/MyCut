import { Toaster as Sonner, type ToasterProps } from "sonner"

import { useTheme } from "@/context/ThemeContext"

const Toaster = ({ ...props }: ToasterProps) => {
  const { theme } = useTheme()

  return (
    <Sonner
      theme={theme}
      position="top-right"
      toastOptions={{
        classNames: {
          toast:
            "group toast border-border bg-popover text-popover-foreground shadow-[var(--ac-shadow)]",
          description: "text-muted-foreground",
          actionButton:
            "bg-primary text-primary-foreground hover:bg-primary/90",
          cancelButton:
            "bg-secondary text-secondary-foreground hover:bg-secondary/80",
        },
      }}
      {...props}
    />
  )
}

export { Toaster }
