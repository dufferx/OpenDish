import { createClient } from 'npm:@supabase/supabase-js@2';
import { createAuthVerifier } from '../_shared/http.ts';
import { createOpenAiProvider } from '../_shared/openai-provider.ts';
import { createAiConfigReader } from '../ai-propose-modification/dependencies.ts';
import { createGenerateRecipeHandler } from './handler.ts';
import { createSupabaseGenerationConversationStore } from './store.ts';

const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const clientOptions = {
  auth: { autoRefreshToken: false, persistSession: false },
};
const authClient = createClient(supabaseUrl, serviceRoleKey, clientOptions);
const serviceClient = createClient(supabaseUrl, serviceRoleKey, clientOptions);

Deno.serve(
  createGenerateRecipeHandler({
    verifyAuth: createAuthVerifier(authClient),
    provider: createOpenAiProvider(),
    aiConfigReader: createAiConfigReader(serviceClient),
    store: createSupabaseGenerationConversationStore(serviceClient),
  }),
);
