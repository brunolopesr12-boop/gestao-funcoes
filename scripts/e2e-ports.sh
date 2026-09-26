#!/usr/bin/env bash
# Libera as portas usadas pelos testes ponta a ponta (app 3100 e gateway 54321).
# fuser é o caminho principal; lsof fica como reserva. Sem erro se nada estiver escutando.
for port in 3100 54321; do
  fuser -k "$port/tcp" >/dev/null 2>&1 || kill $(lsof -t -i:"$port" 2>/dev/null) 2>/dev/null || true
done
sleep 0.5
exit 0
