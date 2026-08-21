-- T015: conversations, conversation_messages, modification_proposals (research R8).

-- Exactly one thread per recipe (unique recipe_id); NULL recipe_id only for
-- pre-save generation threads (kind = 'generation').
create table public.conversations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  recipe_id uuid unique references public.recipes (id) on delete cascade,
  kind text not null check (kind in ('recipe', 'generation')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger conversations_set_updated_at
  before update on public.conversations
  for each row execute function public.set_updated_at();

alter table public.conversations enable row level security;

create policy conversations_owner_all on public.conversations
  for all to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

grant select, insert, update, delete on public.conversations to authenticated;
grant all on public.conversations to service_role;

create table public.conversation_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  position int not null,
  role text not null check (role in ('user', 'assistant')),
  content text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (conversation_id, position)
);

create trigger conversation_messages_set_updated_at
  before update on public.conversation_messages
  for each row execute function public.set_updated_at();

alter table public.conversation_messages enable row level security;

create policy conversation_messages_owner_all on public.conversation_messages
  for all to authenticated
  using (exists (select 1 from public.conversations c where c.id = conversation_id and c.user_id = auth.uid()))
  with check (exists (select 1 from public.conversations c where c.id = conversation_id and c.user_id = auth.uid()));

grant select, insert, update, delete on public.conversation_messages to authenticated;
grant all on public.conversation_messages to service_role;

create table public.modification_proposals (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  -- The assistant message that presented this proposal.
  message_id uuid not null references public.conversation_messages (id) on delete cascade,
  recipe_id uuid not null references public.recipes (id) on delete cascade,
  -- recipes.head_version the proposal was generated from; apply requires it to
  -- still match, otherwise the proposal is stale (research R8, enforced in app logic).
  base_version bigint not null,
  -- Validated ModificationOperations Zod schema.
  operations jsonb not null,
  status text not null default 'pending' check (
    status in ('pending', 'applied', 'variant_created', 'discarded')
  ),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger modification_proposals_set_updated_at
  before update on public.modification_proposals
  for each row execute function public.set_updated_at();

alter table public.modification_proposals enable row level security;

create policy modification_proposals_owner_all on public.modification_proposals
  for all to authenticated
  using (exists (select 1 from public.recipes r where r.id = recipe_id and r.user_id = auth.uid()))
  with check (exists (select 1 from public.recipes r where r.id = recipe_id and r.user_id = auth.uid()));

grant select, insert, update, delete on public.modification_proposals to authenticated;
grant all on public.modification_proposals to service_role;
