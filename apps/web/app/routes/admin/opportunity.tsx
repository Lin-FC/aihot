import { SITE } from "@aihot/industry/site";
import type { Route } from "./+types/opportunity";
import { adminGet } from "../../lib/admin.server";
import { useAdminAction } from "../../features/admin/action";
import { AdminPage, Badge, Button, Card, Time } from "../../features/admin/ui";
import { CreatorScore } from "../../features/creator/Score";

type Detail = Record<string, any>;
export async function loader({ request, params }: Route.LoaderArgs) { return adminGet<Detail>(request, `/api/admin/opportunities/${encodeURIComponent(params.storyId)}`); }
export const meta: Route.MetaFunction = ({ loaderData }) => [{ title: `${loaderData?.title ?? "创作机会"} · ${SITE.name} 后台` }];

export default function Opportunity({ loaderData: o }: Route.ComponentProps) {
  const { run, pending } = useAdminAction();
  const analyze = () => run("POST", `/api/admin/opportunities/${o.story_id}/analyze`, {}, { label: `reanalyze:${o.story_id}`, success: "已加入重新分析队列" });
  const reasons = o.platform_reasons ?? {};
  return <AdminPage title={o.title} subtitle={<span>Story #{o.story_id} · 最新活动 <Time at={o.latest_at}/> · Story v{o.version} / 分析 v{o.story_version}</span>} actions={<Button tone="primary" busy={pending === `reanalyze:${o.story_id}`} onClick={analyze}>重新分析</Button>}>
    <div className="mb-5 flex flex-wrap gap-1.5"><Badge tone="accent">{o.opportunity_type}</Badge><Badge>{o.lifecycle}</Badge>{o.audience_intents.map((x: string) => <Badge key={x}>{x}</Badge>)}{o.stale && <Badge tone="warn">分析已过期</Badge>}<Badge>Attention {Math.round(o.attention ?? 0)}</Badge><Badge>Heat {o.heat == null ? "—" : Number(o.heat).toFixed(1)}</Badge></div>
    <div className="grid gap-5 xl:grid-cols-[1fr_360px]">
      <div className="space-y-5">
        <Card title="事实基础"><h3 className="text-[12px] font-medium text-ink-4">Story 综述</h3><p className="mt-1 whitespace-pre-wrap text-[13.5px] leading-relaxed text-ink-2">{o.digest}</p>{o.latest && <><h3 className="mt-4 text-[12px] font-medium text-ink-4">最新进展</h3><p className="mt-1 whitespace-pre-wrap text-[13.5px] leading-relaxed text-ink-2">{o.latest}</p></>}</Card>
        <Card title="平台适配"><div className="grid gap-3 md:grid-cols-3">{[["微信", o.wechat_score, reasons.wechat], ["小红书", o.xiaohongshu_score, reasons.xiaohongshu], ["抖音", o.douyin_score, reasons.douyin]].map(([label, score, reason]) => <div key={String(label)} className="rounded-card bg-bg-sunk p-3 ring-1 ring-line"><CreatorScore label={String(label)} value={Number(score)}/><p className="mt-3 text-[13px] leading-relaxed text-ink-2">{String(reason ?? "")}</p></div>)}</div></Card>
        <Card title="代表性证据"><div className="divide-y divide-line">{o.evidence.map((e: any) => <div key={e.article_id} className="py-3 first:pt-0 last:pb-0"><a href={e.url} target="_blank" rel="noreferrer" className="font-medium text-ink hover:text-accent">{e.title}</a><div className="mt-1 text-[12px] text-ink-4">{e.source} · <Time at={e.published_at ?? e.timeline_at}/> · Attention {e.score ?? "—"}</div>{e.summary && <p className="mt-1 text-[13px] leading-relaxed text-ink-3">{e.summary}</p>}</div>)}</div></Card>
      </div>
      <div className="space-y-5">
        <Card title="内容角度"><h3 className="text-[12px] text-ink-4">目标受众</h3><p className="mt-1 text-[13.5px] text-ink-2">{o.target_audience}</p><h3 className="mt-4 text-[12px] text-ink-4">主角度</h3><p className="mt-1 text-[13.5px] text-ink-2">{o.core_angle}</p>{o.alternative_angles.length > 0 && <><h3 className="mt-4 text-[12px] text-ink-4">备选角度</h3><ul className="mt-1 list-disc space-y-1 pl-5 text-[13px] text-ink-2">{o.alternative_angles.map((x: string) => <li key={x}>{x}</li>)}</ul></>}</Card>
        <Card title="商业潜力"><CreatorScore label="商业" value={o.commercial_score}/><p className="mt-3 text-[13px] leading-relaxed text-ink-2">{o.commercial_reason}</p><div className="mt-3 flex flex-wrap gap-1">{o.monetization_types.map((x: string) => <Badge key={x}>{x}</Badge>)}</div>{o.offer_ideas.length > 0 && <ul className="mt-3 list-disc space-y-1 pl-5 text-[13px] text-ink-2">{o.offer_ideas.map((x: string) => <li key={x}>{x}</li>)}</ul>}</Card>
        <Card title="分析历史"><div className="space-y-2 text-[12.5px]">{o.history.map((h: any) => <div key={h.id} className="flex justify-between gap-3"><span>v{h.story_version} · {h.trigger} · {h.model}</span><Time at={h.created_at}/></div>)}</div></Card>
      </div>
    </div>
  </AdminPage>;
}
