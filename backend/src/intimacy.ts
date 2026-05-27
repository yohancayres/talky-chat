// ---------------------------------------------------------------------------
// Intimidade por conversa (0-100). Controle INTERNO — nunca exibido ao usuário.
// Define o quanto o personagem se abre e gera atrito quando o usuário força
// intimidade cedo demais.
// ---------------------------------------------------------------------------

/** Intimidade inicial: acabaram de se conhecer, mas já numa vibe amigável. */
export const DEFAULT_INTIMACY = 25;

export function clampIntimacy(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_INTIMACY;
  return Math.max(0, Math.min(100, Math.round(value)));
}

export function applyIntimacyDelta(level: number, delta: number): number {
  return clampIntimacy(level + delta);
}

interface Band {
  closeness: string;
  behavior: string;
}

function band(level: number): Band {
  if (level < 20) {
    return {
      closeness: 'estão se conhecendo agora',
      behavior:
        'Seja simpático(a), curioso(a) e divertido(a) do SEU jeito — nada de ser frio(a), seco(a) ou sério(a) demais. Você puxa papo numa boa; só ainda não despeja assuntos muito profundos nem age como quem já é super íntimo (apelidos carinhosos, declarações, intimidade física).',
    };
  }
  if (level < 40) {
    return {
      closeness: 'já tem uma química amigável rolando',
      behavior:
        'Brinca, se interessa de verdade e divide coisas do dia com leveza. O que é muito íntimo você guarda pra quando a confiança crescer mais.',
    };
  }
  if (level < 65) {
    return {
      closeness: 'viraram amizade',
      behavior:
        'Bem à vontade: brinca bastante, se abre, compartilha coisas pessoais e se importa.',
    };
  }
  if (level < 85) {
    return {
      closeness: 'são amigos próximos',
      behavior:
        'Confidente e caloroso(a); confiam um no outro e falam de quase tudo com naturalidade.',
    };
  }
  return {
    closeness: 'têm um vínculo forte e íntimo',
    behavior: 'Total abertura, intimidade e afeto; conversam de tudo.',
  };
}

/**
 * Trecho de prompt que orienta o quanto o personagem se abre conforme a
 * intimidade. A prioridade é SEMPRE ser caloroso e fiel à personalidade; o
 * atrito só aparece em avanços claramente exagerados. Nunca revela o "nível".
 */
export function describeIntimacyForPrompt(level: number, userName: string): string {
  const { closeness, behavior } = band(level);
  const name = userName || 'a pessoa';

  // O "freio" só existe enquanto a intimidade ainda é baixa/média.
  const boundary =
    level < 65
      ? ` Só se ${name} avançar MUITO além da intimidade que vocês têm — romance ou sexo pesado, declaração intensa, ou algo bem invasivo — não embarque como se já fossem super próximos; mostre que ainda é cedo do SEU jeito, com as suas próprias palavras e seu humor. Em flerte leve ou pergunta pessoal comum, não trave: leve numa boa.`
      : '';

  return `\n# Proximidade com ${name}\nVocês ${closeness}. ${behavior}${boundary}\nIMPORTANTE: sua personalidade, seu humor e seu calor vêm SEMPRE em primeiro lugar — não fique distante, monossilábico(a) ou chato(a) só porque a intimidade ainda é baixa. A intimidade muda só o quanto você se abre em coisas profundas/íntimas, não o quanto você é agradável. NUNCA repita frases ou fórmulas prontas (evite clichês como "vai com calma", "calma lá", "a gente mal se conhece") — varie sempre, fale como gente de verdade. NUNCA mencione que existe um "nível de intimidade" ou qualquer pontuação — isso é interno.\n`;
}
