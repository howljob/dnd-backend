/**
 * Библиотека файлов стола: что мастер загружал в игру (карты, позже — музыка),
 * чтобы файлы можно было перечислить, переиспользовать и удалить.
 *
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.up = (pgm) => {
  pgm.createTable('tabletop_files', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    game_id: { type: 'uuid', notNull: true, references: 'games', onDelete: 'CASCADE' },
    uploaded_by: { type: 'uuid', notNull: false, references: 'users', onDelete: 'SET NULL' },
    kind: { type: 'varchar(20)', notNull: true, default: 'map' },
    url: { type: 'text', notNull: true },
    original_name: { type: 'varchar(255)', notNull: true, default: '' },
    mime: { type: 'varchar(80)', notNull: true, default: '' },
    size_bytes: { type: 'integer', notNull: true, default: 0 },
    width: { type: 'integer', notNull: false },
    height: { type: 'integer', notNull: false },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') }
  });
  pgm.addConstraint('tabletop_files', 'tabletop_files_kind_check', "CHECK (kind IN ('map', 'audio', 'image'))");
  pgm.createIndex('tabletop_files', ['game_id', 'created_at']);
  pgm.addConstraint('tabletop_files', 'tabletop_files_url_unique', 'UNIQUE (url)');
};

/**
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.down = (pgm) => {
  pgm.dropTable('tabletop_files');
};
