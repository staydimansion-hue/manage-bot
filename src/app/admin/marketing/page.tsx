import { env, MARKETING_BOARD_KEY } from "@/lib/config";
import { getSupabase } from "@/lib/supabase";
import {
  getBoardByKey,
  getCategories,
  getItems,
  withCategories,
} from "@/lib/board";
import { ActionItem, Category, ItemStatus, ItemWithCategory } from "@/lib/types";
import {
  addCategory,
  addItem,
  approveItem,
  changeStatus,
  deleteCategory,
  deleteItem,
  rejectItem,
  updateCategory,
  updateItem,
} from "./actions";

export const dynamic = "force-dynamic";

const STATUS_LABEL: Record<ItemStatus, string> = {
  not_started: "미진행",
  in_progress: "진행중",
  done: "완료",
};

export default async function AdminMarketingPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;

  if (!env.adminToken) {
    return (
      <Shell>
        <div className="card">
          <h2>설정 필요</h2>
          <p className="muted">
            ADMIN_TOKEN 환경변수가 설정되지 않았습니다. 배포 환경에 ADMIN_TOKEN 을
            설정하세요.
          </p>
        </div>
      </Shell>
    );
  }

  if (token !== env.adminToken) {
    return (
      <Shell>
        <div className="card">
          <h2>관리자 인증</h2>
          <p className="muted">
            URL에 <code>?token=ADMIN_TOKEN</code> 을 붙여 접속하세요. (경량 인증)
          </p>
        </div>
      </Shell>
    );
  }

  const db = getSupabase();
  if (!db) {
    return (
      <Shell>
        <div className="card">
          <h2>Supabase 미설정</h2>
          <p className="muted">
            SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 를 설정하세요.
          </p>
        </div>
      </Shell>
    );
  }

  const board = await getBoardByKey(db, MARKETING_BOARD_KEY);
  if (!board) {
    return (
      <Shell>
        <div className="card">
          <h2>보드 없음</h2>
          <p className="muted">
            supabase/seed_marketing.sql 을 실행해 marketing 보드를 생성하세요.
          </p>
        </div>
      </Shell>
    );
  }

  const categories = await getCategories(db, board.id, { includeInactive: false });
  const allItems = await getItems(db, board.id, { includePending: true });
  const pending = allItems.filter((i) => !i.approved);
  const active = allItems.filter((i) => i.approved);
  const activeWithCats = withCategories(active, categories);

  return (
    <Shell subtitle={board.name}>
      {/* Pending (auto-extracted) items */}
      <section className="card">
        <h2>자동추출 승인 대기 ({pending.length})</h2>
        {pending.length === 0 && <p className="muted">대기 중인 항목이 없습니다.</p>}
        {pending.map((item) => (
          <div className="item" key={item.id}>
            <div className="item-main">
              <span className="badge pending">auto</span> {item.title}
            </div>
            <div className="row">
              <form action={approveItem} className="inline">
                <Hidden token={token} />
                <input type="hidden" name="id" value={item.id} />
                <button className="primary" type="submit">
                  승인
                </button>
              </form>
              <form action={rejectItem} className="inline">
                <Hidden token={token} />
                <input type="hidden" name="id" value={item.id} />
                <button className="danger" type="submit">
                  거절
                </button>
              </form>
            </div>
          </div>
        ))}
      </section>

      {/* Categories */}
      <section className="card">
        <h2>카테고리</h2>
        {categories.map((c) => (
          <CategoryRow key={c.id} category={c} token={token} />
        ))}
        <form action={addCategory} className="row" style={{ marginTop: 12 }}>
          <Hidden token={token} />
          <input type="text" name="name" placeholder="새 카테고리명" />
          <input
            type="text"
            name="sort_order"
            placeholder="순서"
            style={{ width: 70, flex: "none" }}
          />
          <button className="primary" type="submit">
            추가
          </button>
        </form>
      </section>

      {/* Add item */}
      <section className="card">
        <h2>액션 아이템 추가</h2>
        <form action={addItem} className="row">
          <Hidden token={token} />
          <input type="text" name="title" placeholder="제목" />
          <select name="category_id">
            <option value="">카테고리 없음</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          <input type="date" name="due_date" />
          <button className="primary" type="submit">
            추가
          </button>
        </form>
      </section>

      {/* Active items by category */}
      <section className="card">
        <h2>활성 액션 아이템 ({active.length})</h2>
        {active.length === 0 && <p className="muted">활성 항목이 없습니다.</p>}
        {categories.map((cat) => {
          const items = activeWithCats.filter((i) => i.category_id === cat.id);
          if (items.length === 0) return null;
          return (
            <div key={cat.id} style={{ marginBottom: 16 }}>
              <h3 style={{ fontSize: 14, margin: "8px 0" }}>{cat.name}</h3>
              {items.map((item) => (
                <ItemRow
                  key={item.id}
                  item={item}
                  categories={categories}
                  token={token}
                />
              ))}
            </div>
          );
        })}
        <UncategorizedSection
          items={activeWithCats.filter((i) => !i.category_id)}
          categories={categories}
          token={token}
        />
      </section>
    </Shell>
  );
}

function Shell({
  children,
  subtitle,
}: {
  children: React.ReactNode;
  subtitle?: string;
}) {
  return (
    <main className="container">
      <h1>마케팅 PM 봇 · 관리자</h1>
      {subtitle && <p className="muted">{subtitle}</p>}
      {children}
    </main>
  );
}

function Hidden({ token }: { token: string }) {
  return <input type="hidden" name="token" value={token} />;
}

function CategoryRow({ category, token }: { category: Category; token: string }) {
  return (
    <div className="item">
      <form action={updateCategory} className="row" style={{ flex: 1 }}>
        <Hidden token={token} />
        <input type="hidden" name="id" value={category.id} />
        <input type="text" name="name" defaultValue={category.name} />
        <input
          type="text"
          name="sort_order"
          defaultValue={category.sort_order}
          style={{ width: 70, flex: "none" }}
        />
        <button type="submit">저장</button>
      </form>
      <form action={deleteCategory} className="inline">
        <Hidden token={token} />
        <input type="hidden" name="id" value={category.id} />
        <button className="danger" type="submit">
          삭제
        </button>
      </form>
    </div>
  );
}

function ItemRow({
  item,
  categories,
  token,
}: {
  item: ItemWithCategory;
  categories: Category[];
  token: string;
}) {
  return (
    <div className="item">
      <div className="item-main">
        <span className={`badge ${item.status}`}>{STATUS_LABEL[item.status]}</span>{" "}
        <form action={updateItem} className="row" style={{ marginTop: 6 }}>
          <Hidden token={token} />
          <input type="hidden" name="id" value={item.id} />
          <input type="text" name="title" defaultValue={item.title} />
          <select name="category_id" defaultValue={item.category_id ?? ""}>
            <option value="">카테고리 없음</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          <input type="date" name="due_date" defaultValue={item.due_date ?? ""} />
          <button type="submit">저장</button>
        </form>
      </div>
      <div className="row">
        <StatusButton item={item} status="in_progress" label="진행중" token={token} />
        <StatusButton item={item} status="done" label="완료" token={token} />
        <StatusButton
          item={item}
          status="not_started"
          label="되돌리기"
          token={token}
        />
        <form action={deleteItem} className="inline">
          <Hidden token={token} />
          <input type="hidden" name="id" value={item.id} />
          <button className="danger" type="submit">
            삭제
          </button>
        </form>
      </div>
    </div>
  );
}

function StatusButton({
  item,
  status,
  label,
  token,
}: {
  item: ActionItem;
  status: ItemStatus;
  label: string;
  token: string;
}) {
  return (
    <form action={changeStatus} className="inline">
      <Hidden token={token} />
      <input type="hidden" name="id" value={item.id} />
      <input type="hidden" name="status" value={status} />
      <button type="submit" disabled={item.status === status}>
        {label}
      </button>
    </form>
  );
}

function UncategorizedSection({
  items,
  categories,
  token,
}: {
  items: ItemWithCategory[];
  categories: Category[];
  token: string;
}) {
  if (items.length === 0) return null;
  return (
    <div style={{ marginBottom: 16 }}>
      <h3 style={{ fontSize: 14, margin: "8px 0" }}>기타</h3>
      {items.map((item) => (
        <ItemRow key={item.id} item={item} categories={categories} token={token} />
      ))}
    </div>
  );
}
