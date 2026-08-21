import http from 'node:http';
import process from 'node:process';
import { randomUUID } from 'node:crypto';
import {
  getValue,
  listEdgeFunctions,
  logStep,
  parseArgs,
  prepareLocalProfile,
  repoRoot,
  runCommand,
  runStreamingCommand,
  sqlLiteral,
} from './lib.mjs';

const validRecipeDraft = {
  title: 'Tomato Pasta',
  description: 'A simple weeknight pasta.',
  servings: 2,
  prepTimeMinutes: 10,
  cookTimeMinutes: 20,
  sourceName: 'Local Smoke',
  sourceUrl: 'https://example.com/recipes/tomato-pasta',
  ingredients: [
    { name: 'Spaghetti', quantity: { num: 1, den: 2 }, unit: 'lb' },
    { name: 'Canned tomatoes', quantity: { num: 3, den: 2 }, unit: 'cups' },
    { name: 'Salt', quantity: null, unit: null },
  ],
  steps: [
    { text: 'Boil salted water and cook the spaghetti.' },
    { text: 'Simmer the tomatoes into a sauce.' },
    { text: 'Combine and serve.' },
  ],
  tags: ['pasta', 'quick'],
};

const validRecipeSnapshot = {
  ...validRecipeDraft,
  imagePath: null,
};

const validProposal = {
  summary: 'Scale the recipe from 2 to 4 servings and double the spaghetti.',
  operations: [
    { kind: 'setServings', servings: 4 },
    {
      kind: 'updateIngredient',
      position: 0,
      patch: { quantity: { num: 1, den: 1 } },
    },
  ],
  resultingRecipe: {
    title: 'Smoke Pasta',
    description: 'Fixture recipe for local smoke tests.',
    servings: 4,
    prepTimeMinutes: 10,
    cookTimeMinutes: 20,
    sourceName: 'Local Smoke',
    sourceUrl: 'https://example.com/local-smoke',
    ingredients: [
      { name: 'Spaghetti', quantity: { num: 1, den: 1 }, unit: 'lb' },
      { name: 'Tomatoes', quantity: { num: 3, den: 2 }, unit: 'cups' },
    ],
    steps: [{ text: 'Boil the pasta.' }, { text: 'Simmer the sauce.' }],
    tags: [],
  },
};

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function createFakeAiServer() {
  const server = http.createServer(async (request, response) => {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1');
    if (request.method === 'GET' && url.pathname === '/v1/models') {
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ data: [{ id: 'smoke-model' }] }));
      return;
    }

    if (request.method === 'POST' && url.pathname === '/v1/chat/completions') {
      const chunks = [];
      for await (const chunk of request) {
        chunks.push(Buffer.from(chunk));
      }
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      const schemaName = body.response_format?.json_schema?.name;
      let content = 'Local smoke answer.';

      if (schemaName === 'generate_recipe_outcome') {
        content = JSON.stringify({ kind: 'draft', draft: validRecipeDraft });
      } else if (schemaName === 'modification_proposal') {
        content = JSON.stringify(validProposal);
      } else if (schemaName === 'recipe_draft') {
        content = JSON.stringify(validRecipeDraft);
      } else if (Array.isArray(body.messages)) {
        const recipeJson = JSON.stringify(validRecipeSnapshot);
        content = `Local smoke answer based on ${recipeJson.length} recipe bytes.`;
      }

      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(
        JSON.stringify({
          choices: [{ message: { content } }],
        }),
      );
      return;
    }

    response.writeHead(404, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ error: 'not_found' }));
  });

  return new Promise((resolve, reject) => {
    server.listen(0, '0.0.0.0', () => resolve(server));
    server.on('error', reject);
  });
}

function closeServer(server) {
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });
}

async function httpJson(url, options = {}) {
  let response;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      response = await fetch(url, options);
      break;
    } catch (error) {
      if (attempt === 3) throw error;
      await new Promise((resolve) => setTimeout(resolve, attempt * 250));
    }
  }
  const text = await response.text();
  let body = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
  }

  return {
    status: response.status,
    body,
    headers: response.headers,
  };
}

async function waitForFunctions(status, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  const probeUrl = `${status.FUNCTIONS_URL}/ai-configure`;

  while (Date.now() < deadline) {
    try {
      const response = await fetch(probeUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'status' }),
      });
      if (
        response.status === 401 ||
        response.status === 400 ||
        response.status === 405
      ) {
        return;
      }
    } catch {
      // keep polling until the child process is ready
    }

    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  throw new Error(
    'Timed out waiting for local Edge Functions to become reachable.',
  );
}

function startFunctionsServe() {
  return new Promise((resolve, reject) => {
    const processChild = import('node:child_process').then(({ spawn }) =>
      spawn('pnpm', ['supabase', 'functions', 'serve'], {
        cwd: repoRoot,
        stdio: ['ignore', 'pipe', 'pipe'],
      }),
    );

    processChild
      .then((serveChild) => {
        let settled = false;
        const forward = (chunk) => {
          const text = chunk.toString('utf8');
          if (text.trim()) {
            process.stdout.write(text);
          }
          if (
            !settled &&
            /Serving functions|Bootstrapping Edge Runtime/i.test(text)
          ) {
            settled = true;
            resolve(serveChild);
          }
        };

        serveChild.stdout.on('data', forward);
        serveChild.stderr.on('data', forward);
        serveChild.on('error', reject);
        serveChild.on('exit', (code) => {
          if (!settled) {
            reject(
              new Error(
                `supabase functions serve exited early with status ${code ?? 'unknown'}`,
              ),
            );
          }
        });

        setTimeout(() => {
          if (!settled) {
            settled = true;
            resolve(serveChild);
          }
        }, 4_000);
      })
      .catch(reject);
  });
}

function stopFunctionsServe(child) {
  if (!child || child.killed) return;
  child.kill('SIGTERM');
}

function authHeaders(status, token) {
  return {
    apikey: status.PUBLISHABLE_KEY,
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  };
}

function insertRecipeFixture(userId, recipeId) {
  const statements = [
    `
    insert into public.recipes (
      id, user_id, title, description, servings, prep_time_minutes, cook_time_minutes,
      image_path, source_name, source_url, origin
    ) values (
      ${sqlLiteral(recipeId)},
      ${sqlLiteral(userId)},
      'Smoke Pasta',
      'Fixture recipe for local smoke tests.',
      2,
      10,
      20,
      null,
      'Local Smoke',
      'https://example.com/local-smoke',
      'manual'
    )
    `,
    `
    insert into public.recipe_ingredients (recipe_id, position, name, quantity_num, quantity_den, unit)
    values
      (${sqlLiteral(recipeId)}, 0, 'Spaghetti', 1, 2, 'lb'),
      (${sqlLiteral(recipeId)}, 1, 'Tomatoes', 3, 2, 'cups')
    `,
    `
    insert into public.recipe_steps (recipe_id, position, text)
    values
      (${sqlLiteral(recipeId)}, 0, 'Boil the pasta.'),
      (${sqlLiteral(recipeId)}, 1, 'Simmer the sauce.')
    `,
  ];

  for (const statement of statements) {
    runCommand('pnpm', ['supabase', 'db', 'query', '--local', statement]);
  }
}

async function createUser(status) {
  const email = `local-smoke-${Date.now()}@example.com`;
  const password = 'smoke-pass-123';
  const result = await httpJson(`${status.API_URL}/auth/v1/signup`, {
    method: 'POST',
    headers: {
      apikey: status.PUBLISHABLE_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ email, password }),
  });

  assert(
    result.status === 200,
    `Auth signup failed with HTTP ${result.status}`,
  );
  assert(result.body?.user?.id, 'Auth signup did not return a user id.');
  let accessToken = result.body?.session?.access_token ?? null;

  if (!accessToken) {
    const signIn = await httpJson(
      `${status.API_URL}/auth/v1/token?grant_type=password`,
      {
        method: 'POST',
        headers: {
          apikey: status.PUBLISHABLE_KEY,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ email, password }),
      },
    );

    assert(
      signIn.status === 200,
      `Password sign-in fallback failed with HTTP ${signIn.status}: ${JSON.stringify(signIn.body)}`,
    );
    accessToken = signIn.body?.access_token ?? null;
  }

  assert(
    accessToken,
    `Auth flow did not return an access token: ${JSON.stringify(result.body)}`,
  );

  return {
    email,
    password,
    userId: result.body.user.id,
    accessToken,
  };
}

async function runStorageSmoke(status, user, recipeId) {
  const objectPath = `${user.userId}/${recipeId}/smoke.png`;
  const payload = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
    'base64',
  );
  const upload = await fetch(
    `${status.API_URL}/storage/v1/object/recipe-images/${objectPath}`,
    {
      method: 'POST',
      headers: {
        apikey: status.PUBLISHABLE_KEY,
        Authorization: `Bearer ${user.accessToken}`,
        'Content-Type': 'image/png',
        'x-upsert': 'true',
      },
      body: payload,
    },
  );
  assert(upload.ok, `Storage upload failed with HTTP ${upload.status}`);

  const download = await fetch(
    `${status.API_URL}/storage/v1/object/authenticated/recipe-images/${objectPath}`,
    {
      headers: {
        apikey: status.PUBLISHABLE_KEY,
        Authorization: `Bearer ${user.accessToken}`,
      },
    },
  );
  assert(download.ok, `Storage download failed with HTTP ${download.status}`);
  const body = Buffer.from(await download.arrayBuffer());
  assert(body.equals(payload), 'Storage round-trip payload mismatch.');
}

async function invokeFunction(status, name, token, payload) {
  const response = await httpJson(`${status.FUNCTIONS_URL}/${name}`, {
    method: 'POST',
    headers: authHeaders(status, token),
    body: JSON.stringify(payload),
  });

  assert(
    response.status === 200,
    `${name} failed with HTTP ${response.status}: ${JSON.stringify(response.body)}`,
  );
  return response.body;
}

async function runLiveSmoke(status) {
  logStep('Running live local smoke checks');
  const fakeAiServer = await createFakeAiServer();
  const fakeAiAddress = fakeAiServer.address();
  const serveChild = await startFunctionsServe();

  try {
    await waitForFunctions(status);
    const user = await createUser(status);
    const recipeId = randomUUID();
    insertRecipeFixture(user.userId, recipeId);
    await runStorageSmoke(status, user, recipeId);

    const configStatus = await invokeFunction(
      status,
      'ai-configure',
      user.accessToken,
      {
        action: 'status',
      },
    );
    assert(
      configStatus?.configured === false,
      'ai-configure status should start unconfigured.',
    );

    const baseUrlCandidates = [
      `http://127.0.0.1:${fakeAiAddress.port}/v1`,
      `http://host.docker.internal:${fakeAiAddress.port}/v1`,
      `http://172.17.0.1:${fakeAiAddress.port}/v1`,
    ];
    let upsert = null;
    let lastUpsertError = null;
    for (const baseUrl of baseUrlCandidates) {
      const response = await httpJson(`${status.FUNCTIONS_URL}/ai-configure`, {
        method: 'POST',
        headers: authHeaders(status, user.accessToken),
        body: JSON.stringify({
          action: 'upsert',
          provider: 'openai',
          apiKey: 'sk-local-smoke',
          model: 'smoke-model',
          baseUrl,
        }),
      });

      if (response.status === 200) {
        upsert = response.body;
        break;
      }

      lastUpsertError = `baseUrl=${baseUrl} -> HTTP ${response.status}`;
    }

    assert(
      upsert,
      `ai-configure could not reach the local fake AI provider (${lastUpsertError})`,
    );
    assert(
      upsert?.status === 'valid',
      'ai-configure upsert did not validate credentials.',
    );

    const generated = await invokeFunction(
      status,
      'ai-generate-recipe',
      user.accessToken,
      {
        message: 'Generate a quick pasta dinner.',
      },
    );
    assert(
      generated?.outcome?.kind === 'draft',
      'ai-generate-recipe did not return a draft.',
    );

    const answer = await invokeFunction(
      status,
      'ai-recipe-chat',
      user.accessToken,
      {
        recipeId,
        message: 'How long does it take?',
        intent: 'answer',
      },
    );
    assert(
      answer?.outcome?.kind === 'answer',
      'ai-recipe-chat did not return an answer.',
    );

    const proposal = await invokeFunction(
      status,
      'ai-propose-modification',
      user.accessToken,
      {
        recipeId,
        request: 'Make four servings.',
      },
    );
    assert(
      proposal?.outcome?.kind === 'proposal',
      'ai-propose-modification did not return a proposal.',
    );

    const imported = await invokeFunction(
      status,
      'import-recipe',
      user.accessToken,
      {
        mode: 'text',
        text: 'Title: Tomato Pasta. Ingredients: spaghetti, tomatoes. Steps: boil pasta, simmer sauce, combine. Serves 2.',
      },
    );
    assert(
      imported?.extractionMethod === 'ai',
      'import-recipe did not use AI extraction.',
    );

    const remove = await invokeFunction(
      status,
      'ai-configure',
      user.accessToken,
      {
        action: 'remove',
      },
    );
    assert(
      remove?.status === 'unconfigured',
      'ai-configure remove did not report the unconfigured state.',
    );
    const statusAfterRemove = await invokeFunction(
      status,
      'ai-configure',
      user.accessToken,
      { action: 'status' },
    );
    assert(
      statusAfterRemove?.configured === false,
      'ai-configure remove did not clear the config.',
    );

    const expectedFunctions = new Set(listEdgeFunctions());
    [
      'ai-configure',
      'ai-generate-recipe',
      'ai-recipe-chat',
      'ai-propose-modification',
      'import-recipe',
    ].forEach((name) => expectedFunctions.delete(name));
    assert(
      expectedFunctions.size === 0,
      `Uncovered edge functions: ${[...expectedFunctions].join(', ')}`,
    );
  } finally {
    stopFunctionsServe(serveChild);
    await closeServer(fakeAiServer);
  }
}

export async function runSmokeSuite(options = {}) {
  if (!options.skipDbTests) {
    logStep('Running pgTAP database tests');
    await runStreamingCommand('pnpm', [
      'supabase',
      'test',
      'db',
      '--local',
      'supabase/tests',
    ]);
  }

  if (!options.skipFunctionUnitTests) {
    logStep('Running Edge Function unit tests');
    await runStreamingCommand('pnpm', [
      '--filter',
      '@opendish/functions',
      'test',
    ]);
  }

  if (!options.skipLiveChecks) {
    await runLiveSmoke(options.status);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = parseArgs(process.argv.slice(2));
  const result = await prepareLocalProfile({
    envFile: getValue(args, '--env-file'),
    backupManagedEnv: args.flags.has('--backup-managed-env'),
    forceEnv: args.flags.has('--force-env'),
    skipReset: args.flags.has('--skip-reset'),
    recreateStack: !args.flags.has('--preserve-stack'),
    writeEnv: !args.flags.has('--no-write-env'),
  });

  await runSmokeSuite({
    status: result.status,
    skipDbTests: args.flags.has('--skip-db-tests'),
    skipFunctionUnitTests: args.flags.has('--skip-function-unit-tests'),
    skipLiveChecks: args.flags.has('--skip-live-checks'),
  });
}
