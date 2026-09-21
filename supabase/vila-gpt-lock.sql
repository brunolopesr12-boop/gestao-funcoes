-- =====================================================================
--  VILA GPT - TRAVA OPCIONAL DA BASE DE CONHECIMENTO
--
--  Por padrao o app inteiro usa a chave anon (sem login), entao qualquer
--  pessoa com a chave consegue ler e escrever em qualquer tabela. Este
--  arquivo restringe as tabelas do VILA GPT:
--    kb_articles        -> navegador so LE; escreve so o servidor (service_role)
--    gpt_questions      -> so o servidor (o historico dos funcionarios deixa
--                          de ser legivel com a chave anon)
--    gpt_login_attempts -> so o servidor
--
--  So rode este arquivo depois de definir SUPABASE_SERVICE_ROLE_KEY nas
--  variaveis de ambiente (Vercel > Settings > Environment Variables) e
--  fazer o redeploy. Sem essa chave o servidor nao consegue gravar e o
--  VILA GPT para de registrar perguntas.
--
--  Rodar o schema.sql de novo NAO desfaz esta trava. Para desfazer,
--  rode o bloco no fim deste arquivo.
-- =====================================================================
do $blk$
declare t text;
begin
  foreach t in array array['kb_articles','gpt_questions','gpt_login_attempts'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists "acesso_total_app" on public.%I', t);
    execute format('drop policy if exists "leitura_app" on public.%I', t);
    execute format('drop policy if exists "escrita_servidor" on public.%I', t);
    execute format(
      'create policy "escrita_servidor" on public.%I
         for all to service_role using (true) with check (true)', t);
  end loop;
  -- o navegador continua lendo a base de conhecimento (aba Manual, administracao)
  create policy "leitura_app" on public.kb_articles
    for select to anon, authenticated using (true);
end $blk$;

-- ---------------------------------------------------------------------
-- DESFAZER A TRAVA (voltar ao padrao aberto do app): descomente e rode.
-- ---------------------------------------------------------------------
-- do $blk$
-- declare t text;
-- begin
--   foreach t in array array['kb_articles','gpt_questions','gpt_login_attempts'] loop
--     execute format('drop policy if exists "leitura_app" on public.%I', t);
--     execute format('drop policy if exists "escrita_servidor" on public.%I', t);
--     execute format('drop policy if exists "acesso_total_app" on public.%I', t);
--     execute format(
--       'create policy "acesso_total_app" on public.%I
--          for all to anon, authenticated using (true) with check (true)', t);
--   end loop;
-- end $blk$;
