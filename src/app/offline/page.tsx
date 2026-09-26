export default function OfflinePage() {
  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center px-5 text-center">
      <div className="mb-3 text-5xl">📴</div>
      <h1 className="text-2xl font-extrabold">Sem conexão</h1>
      <p className="mt-2 text-sm text-slate-400">
        Esta tela ainda não foi aberta com internet. Conecte-se e tente de novo. As operações que você já registrou
        sem conexão (contagens, temperaturas, checklists, perdas) estão guardadas no aparelho e serão enviadas automaticamente.
      </p>
      <a href="/" className="mt-6 inline-flex items-center justify-center rounded-xl bg-[var(--accent)] px-4 py-3 font-semibold text-white">Tentar novamente</a>
    </div>
  );
}
