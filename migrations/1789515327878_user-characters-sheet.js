/**
 * T5.1 — нормализация листа персонажа.
 *
 * Было: расширенный лист хранился JSON-строкой (sheetVersion: 1) в текстовом
 * поле user_characters.notes, портрет — data-URL внутри того же JSON.
 *
 * Стало:
 *   - sheet jsonb NOT NULL DEFAULT '{}' — структура листа (abilities, skills,
 *     saves, combat/hp, spells, equipment, personality...). По sheet можно
 *     фильтровать SQL-ом: sheet->>'level', sheet->'abilities'->>'str' и т.д.
 *   - portrait_path text NULL — путь файла портрета в uploads/portraits (T5.2).
 *   - notes — снова обычные человеческие заметки.
 *
 * Перенос данных: JSON из notes раскладывается в sheet; портрет-dataURL
 * сохраняется в sheet.legacyPortrait (не теряем, конвертация в файл — при
 * следующем сохранении, T5.2); человеческий текст (freeNotes или старый
 * plain-text) остаётся в notes.
 *
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.up = (pgm) => {
  pgm.addColumns('user_characters', {
    sheet: {
      type: 'jsonb',
      notNull: true,
      default: '{}'
    },
    portrait_path: {
      type: 'text',
      notNull: false
    }
  });

  // Построчный перенос с защитой от битого JSON: невалидные notes остаются
  // обычным текстом, миграция не падает.
  pgm.sql(`
    DO $$
    DECLARE
      rec RECORD;
      parsed jsonb;
      next_sheet jsonb;
      next_notes text;
    BEGIN
      FOR rec IN SELECT id, notes FROM user_characters WHERE notes IS NOT NULL LOOP
        BEGIN
          parsed := rec.notes::jsonb;
        EXCEPTION WHEN others THEN
          parsed := NULL;
        END;

        IF parsed IS NULL OR jsonb_typeof(parsed) <> 'object' THEN
          CONTINUE;
        END IF;
        IF NOT (parsed ? 'sheetVersion') THEN
          CONTINUE;
        END IF;

        next_sheet := parsed - 'sheetVersion' - 'portrait' - 'freeNotes';
        IF coalesce(parsed ->> 'portrait', '') <> '' THEN
          next_sheet := next_sheet || jsonb_build_object('legacyPortrait', parsed -> 'portrait');
        END IF;
        next_sheet := next_sheet || jsonb_build_object('sheetVersion', 2);

        next_notes := nullif(trim(coalesce(parsed ->> 'freeNotes', '')), '');

        UPDATE user_characters
        SET sheet = next_sheet,
            notes = next_notes
        WHERE id = rec.id;
      END LOOP;
    END
    $$;
  `);

  // Быстрый доступ по уровню из sheet (критерий T5.1: sheet->>'level').
  pgm.sql(`
    UPDATE user_characters
    SET sheet = sheet || jsonb_build_object('level', to_jsonb(level::text))
    WHERE sheet <> '{}'::jsonb AND NOT (sheet ? 'level');
  `);
};

/**
 * Откат: собираем обратно JSON-строку sheetVersion:1 в notes (портрет
 * возвращается из legacyPortrait), затем удаляем новые колонки.
 *
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.down = (pgm) => {
  pgm.sql(`
    UPDATE user_characters
    SET notes = (
      (sheet - 'legacyPortrait' - 'sheetVersion' - 'level')
      || jsonb_build_object('sheetVersion', 1)
      || CASE
           WHEN coalesce(sheet ->> 'legacyPortrait', '') <> ''
             THEN jsonb_build_object('portrait', sheet -> 'legacyPortrait')
           ELSE '{}'::jsonb
         END
      || jsonb_build_object('freeNotes', coalesce(notes, ''))
    )::text
    WHERE sheet <> '{}'::jsonb;
  `);

  pgm.dropColumns('user_characters', ['sheet', 'portrait_path']);
};
