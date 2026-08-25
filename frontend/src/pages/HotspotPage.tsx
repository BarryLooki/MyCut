import { Icon } from '@iconify/react'
import graphUpBold from '@iconify-icons/solar/graph-up-bold'

import HotspotPanel from '@/components/HotspotPanel'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

/**
 * 查热点全页：从工作台入口进入。
 * 完整流程都在这一页：查热点 → 生成大纲 → 生成文案 → 保存到文案库 / 用这个文案剪视频。
 */
const HotspotPage = () => (
  <main className="relative min-h-svh overflow-hidden bg-background px-5 py-8 sm:px-8 lg:px-12 lg:py-12">
    <div className="brand-halo pointer-events-none absolute left-1/2 top-0 h-64 w-[34rem] -translate-x-1/2 opacity-55 dark:opacity-25" />

    <div className="relative mx-auto max-w-5xl">
      <header className="mb-8 flex items-center gap-4">
        <span className="brand-gradient flex size-11 shrink-0 items-center justify-center rounded-2xl text-white shadow-sm">
          <Icon icon={graphUpBold} className="size-6 text-white" />
        </span>
        <div>
          <h1 className="text-2xl font-semibold tracking-[-0.025em]">AI 查热点</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            输入内容领域，找到值得创作的选题并继续生成大纲与文案。
          </p>
        </div>
      </header>

      <Card className="rounded-[2rem]">
        <CardHeader className="px-6 pb-4 pt-6 sm:px-8 sm:pt-8">
          <CardTitle className="text-base">寻找创作方向</CardTitle>
          <CardDescription>选择热点后会直接进入文案创作流程。</CardDescription>
        </CardHeader>
        <CardContent className="px-6 pb-6 sm:px-8 sm:pb-8">
          <HotspotPanel />
        </CardContent>
      </Card>
    </div>
  </main>
)

export default HotspotPage
