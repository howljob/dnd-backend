/**
 * Шаблоны писем (T3.1). Русский язык, чистый HTML + текстовая версия.
 */

function escapeHtml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function layout({ title, bodyHtml }) {
  return `<!doctype html>
<html lang="ru">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)}</title>
</head>
<body style="margin:0; padding:0; background:#f4f1ea; font-family:Arial, Helvetica, sans-serif; color:#2b2b2b;">
  <div style="max-width:560px; margin:0 auto; padding:24px 16px;">
    <div style="background:#ffffff; border:1px solid #e0d9c8; border-radius:12px; padding:28px 24px;">
      <div style="font-size:20px; font-weight:bold; color:#7b2d26; margin-bottom:4px;">DnD-Hub</div>
      ${bodyHtml}
    </div>
    <div style="text-align:center; color:#8a8578; font-size:12px; padding:16px 8px;">
      Это автоматическое письмо от платформы DnD-Hub — отвечать на него не нужно.
    </div>
  </div>
</body>
</html>`;
}

function button(url, label) {
  return `<p style="margin:24px 0;">
    <a href="${escapeHtml(url)}" style="display:inline-block; background:#7b2d26; color:#ffffff; text-decoration:none; padding:12px 24px; border-radius:8px; font-weight:bold;">${escapeHtml(label)}</a>
  </p>
  <p style="font-size:13px; color:#6b675c; word-break:break-all;">
    Если кнопка не работает, скопируйте ссылку в адресную строку браузера:<br>
    <a href="${escapeHtml(url)}" style="color:#7b2d26;">${escapeHtml(url)}</a>
  </p>`;
}

/**
 * Письмо «подтвердите почту».
 */
function confirmEmail({ displayName, confirmUrl }) {
  const name = displayName ? `, ${displayName}` : '';
  const subject = 'Подтвердите почту — DnD-Hub';

  const bodyHtml = `
      <h1 style="font-size:18px; margin:16px 0 8px;">Подтверждение почты</h1>
      <p style="line-height:1.5;">Здравствуйте${escapeHtml(name)}!</p>
      <p style="line-height:1.5;">Вы зарегистрировались на DnD-Hub — платформе для поиска игр и проведения сессий D&amp;D. Осталось подтвердить, что эта почта ваша.</p>
      ${button(confirmUrl, 'Подтвердить почту')}
      <p style="font-size:13px; color:#6b675c; line-height:1.5;">Ссылка действует 24 часа. Если вы не регистрировались на DnD-Hub — просто удалите это письмо, ничего не произойдёт.</p>`;

  const text = [
    `Здравствуйте${displayName ? `, ${displayName}` : ''}!`,
    '',
    'Вы зарегистрировались на DnD-Hub. Чтобы подтвердить почту, перейдите по ссылке:',
    confirmUrl,
    '',
    'Ссылка действует 24 часа. Если вы не регистрировались на DnD-Hub — просто удалите это письмо.'
  ].join('\n');

  return {
    subject,
    html: layout({ title: subject, bodyHtml }),
    text
  };
}

/**
 * Письмо «восстановление пароля».
 */
function resetPassword({ displayName, resetUrl }) {
  const name = displayName ? `, ${displayName}` : '';
  const subject = 'Восстановление пароля — DnD-Hub';

  const bodyHtml = `
      <h1 style="font-size:18px; margin:16px 0 8px;">Восстановление пароля</h1>
      <p style="line-height:1.5;">Здравствуйте${escapeHtml(name)}!</p>
      <p style="line-height:1.5;">Кто-то (надеемся, что вы) запросил смену пароля на DnD-Hub. Чтобы задать новый пароль, нажмите кнопку ниже.</p>
      ${button(resetUrl, 'Задать новый пароль')}
      <p style="font-size:13px; color:#6b675c; line-height:1.5;">Ссылка действует 1 час и работает только один раз. Если вы не запрашивали смену пароля — просто удалите это письмо, ваш пароль останется прежним.</p>`;

  const text = [
    `Здравствуйте${displayName ? `, ${displayName}` : ''}!`,
    '',
    'Кто-то запросил смену пароля на DnD-Hub. Чтобы задать новый пароль, перейдите по ссылке:',
    resetUrl,
    '',
    'Ссылка действует 1 час и работает только один раз. Если вы не запрашивали смену пароля — удалите это письмо.'
  ].join('\n');

  return {
    subject,
    html: layout({ title: subject, bodyHtml }),
    text
  };
}

module.exports = {
  confirmEmail,
  resetPassword
};
