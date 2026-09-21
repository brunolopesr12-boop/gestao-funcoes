-- =====================================================================
--  VILA GPT - TRAVA OPCIONAL DA BASE DE CONHECIMENTO
--
--  Por padrao o app inteiro usa a chave anon (sem login), entao qualquer
--  pessoa com a chave consegue escrever em qualquer tabela. Este arquivo
--  restringe a ESCRITA em kb_articles e gpt_questions a chave de servico
--  (service_role), que so o servidor conhece.
--
--  So rode este arquivo depois de definir SUPABASE_SERVICE_ROLE_KEY nas
--  variaveis de ambiente (Vercel > Settings > Environment Variables) e
--  fazer o redeploy. Sem essa chave o servidor nao consegue gravar e o
--  VILA GPT para de responder.
--
--  Para desfazer: rode de novo o bloco de RLS do supabase/schema.sql.
-- =====================================================================
do $blk$
declare t text;
begin
  foreach t in array array['kb_articles','gpt_questions'] loop
    execute format('drop policy if exists "acesso_total_app" on public.%I', t);
    execute format('drop policy if exists "leitura_app" on public.%I', t);
    execute format('drop policy if exists "escrita_servidor" on public.%I', t);
    execute format(
      'create policy "leitura_app" on public.%I
         for select to anon, authenticated using (true)', t);
    execute format(
      'create policy "escrita_servidor" on public.%I
         for all to service_role using (true) with check (true)', t);
  end loop;
end $blk$;
