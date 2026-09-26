"use client";

import { useParams } from "next/navigation";
import { RecipeEditor } from "@/components/ops/producao/RecipeEditor";

/** Editar uma ficha técnica existente (dados, ingredientes, custo). */
export default function RecipePage() {
  const params = useParams<{ id: string }>();
  return <RecipeEditor recipeId={params.id} />;
}
