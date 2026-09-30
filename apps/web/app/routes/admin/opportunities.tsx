import { SITE } from "@aihot/industry/site";
import { Link, useNavigate } from "react-router";
import type { Route } from "./+types/opportunities";
import { adminGet } from "../../lib/admin.server";
import { AdminPage, Badge, Card, DataTable, Time } from "../../features/admin/ui";
import { CreatorScore } from "../../features/creator/Score";

type Row = Record<string, any>;
export async function loader({ request }: Route.LoaderArgs) {
  const page = Math.max(1, Number(new URL(request.url).searchParams.get("page")) || 1);
  return adminGet<{ page: number; pageSize: number; total: number; rows: Row[] }>(request, `/api/admin/opportunities?page=${page}`);
}
export const meta: Route.MetaFunction = () => [{ title: `创作机会 · ${SITE.name} 后台` }];

export default function Opportunities({ loaderData }: Route.ComponentProps) {
  const navigate = useNavigate();
  return <AdminPage title="创作机会" subtitle="基于 Story 的平台适配与商业潜力判断。Attention 与 Heat 是独立的 AIHOT 实时信号，不参与合成分。">
    <Card pad={false} title="近期机会" right={<span>{loaderData.total} 个</span>}>
      <DataTable rows={loaderData.rows} rowKey={(r) => r.story_id} onRowClick={(r) => navigate(`/admin/opportunities/${r.story_id}`)} empty="暂无已分析的创作机会。Worker 每 10 分钟扫描一次符合条件的 Story。" columns={[
        { key: "story", label: "Story / 机会", render: (r) => <div className="min-w-[330px] max-w-xl"><Link className="font-medium text-ink hover:text-accent" to={`/admin/opportunities/${r.story_id}`} onClick={(e) => e.stopPropagation()}>{r.title}</Link><p className="mt-1 line-clamp-2 text-[12.5px] text-ink-3">{r.core_angle}</p><div className="mt-1.5 flex flex-wrap gap-1"><Badge tone="accent">{r.opportunity_type}</Badge><Badge>{r.lifecycle}</Badge>{r.audience_intents.map((x: string) => <Badge key={x}>{x}</Badge>)}{r.stale && <Badge tone="warn">待更新</Badge>}</div></div> },
        { key: "signals", label: "AIHOT 信号", render: (r) => <div className="whitespace-nowrap text-[12.5px]"><div>Attention <span className="num font-semibold">{Math.round(r.attention ?? 0)}</span></div><div>Heat <span className="num font-semibold">{r.heat == null ? "—" : Number(r.heat).toFixed(1)}</span></div></div> },
        { key: "scores", label: "Creator 平台分", render: (r) => <div className="flex gap-2"><CreatorScore label="微信" value={r.wechat_score}/><CreatorScore label="小红书" value={r.xiaohongshu_score}/><CreatorScore label="抖音" value={r.douyin_score}/><CreatorScore label="商业" value={r.commercial_score}/></div> },
        { key: "fresh", label: "活动 / 分析", render: (r) => <div className="space-y-1 whitespace-nowrap text-[12px]"><div>活动 <Time at={r.latest_at}/></div><div>分析 <Time at={r.analyzed_at}/></div><div className="text-ink-4">Story v{r.version} / 分析 v{r.story_version}</div></div> },
      ]}/>
    </Card>
    {loaderData.total > loaderData.pageSize && <div className="mt-4 flex justify-end gap-2 text-[13px]">{loaderData.page > 1 && <Link to={`?page=${loaderData.page - 1}`} className="text-accent">上一页</Link>}{loaderData.page * loaderData.pageSize < loaderData.total && <Link to={`?page=${loaderData.page + 1}`} className="text-accent">下一页</Link>}</div>}
  </AdminPage>;
}
