import { appearanceSchema } from '@impartation/shared';
import { drawAppearancePreview } from './appearancePreview';
import {
  adminUserAction, changePassword, createAdminUser, listAdminUsers, loadProfile,
  registerAccount, registrationMode, resetPassword, signIn, signOut,
  type AdminAction, type AdminUser, type Profile,
} from './identity';

function required<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Missing element: ${id}`);
  return node as T;
}
function errorText(error: unknown): string { return error instanceof Error ? error.message : String(error); }

export function mountAccounts(onProfile: (profile: Profile | undefined) => void) {
  const status = required<HTMLElement>('account-status');
  const feedback = required<HTMLElement>('account-feedback');
  const signInForm = required<HTMLFormElement>('sign-in-form');
  const registerForm = required<HTMLFormElement>('register-form');
  const accountActions = required<HTMLElement>('account-actions');
  const adminDialog = required<HTMLDialogElement>('admin-dialog');
  let profile: Profile | undefined;
  let mode: 'sign-in' | 'register' = 'sign-in';
  let resetToken: string | undefined;
  let authPending = false;
  const setBusy = (busy: boolean) => {
    authPending = busy;
    document.querySelectorAll<HTMLButtonElement>('#account-panel button[type="submit"]').forEach(button => { button.disabled = busy; });
  };
  const acceptProfile = (value: Profile | undefined) => {
    profile = value;
    if (!value) mode = 'sign-in';
    onProfile(value);
    renderStatus();
  };
  function renderStatus() {
    status.textContent = profile
      ? `已登录：${profile.displayName ?? profile.name}（@${profile.username ?? '匿名'} · ${profile.role === 'admin' ? '管理员' : '成员'}）`
      : '请登录或注册账号后进入空间。';
    signInForm.hidden = Boolean(profile) || mode !== 'sign-in' || Boolean(resetToken);
    registerForm.hidden = Boolean(profile) || mode !== 'register' || Boolean(resetToken);
    accountActions.hidden = !profile;
    const loginRoute = document.body.classList.contains('login-route');
    required<HTMLElement>('auth-forms').hidden = Boolean(profile) || !loginRoute || Boolean(resetToken);
    required<HTMLElement>('reset-password-panel').hidden = !resetToken || !loginRoute;
    required<HTMLElement>('welcome-grid').hidden = Boolean(resetToken);
    required<HTMLElement>('key-hints').hidden = Boolean(resetToken);
    required<HTMLButtonElement>('open-admin').hidden = profile?.role !== 'admin';
    required<HTMLElement>('signed-out-note').hidden = Boolean(profile) || loginRoute;
    required<HTMLAnchorElement>('open-login-page').hidden = Boolean(profile) || loginRoute;
    // The outfit preview belongs to an account; signed out it would only show the default look.
    required<HTMLElement>('welcome-outfit').hidden = !profile;
  }
  window.addEventListener('login-route-change', renderStatus);
  const usernameOf = (form: HTMLFormElement) => String(new FormData(form).get('username') ?? '').trim();
  function updateRegistrationMode(value: 'open' | 'code' | 'admin') {
    const registerButton = required<HTMLButtonElement>('show-register');
    registerButton.hidden = value === 'admin';
    required<HTMLElement>('registration-code-field').hidden = value !== 'code';
    required<HTMLElement>('registration-note').textContent = value === 'open'
      ? '现在可以自行创建账号。'
      : value === 'code' ? '注册时需要管理员提供的注册码。' : '当前仅管理员可以创建账号。';
  }
  function showMode(next: 'sign-in' | 'register') {
    mode = next;
    feedback.textContent = '';
    renderStatus();
  }
  required<HTMLButtonElement>('show-register').addEventListener('click', () => showMode('register'));
  required<HTMLButtonElement>('show-sign-in').addEventListener('click', () => showMode('sign-in'));
  signInForm.addEventListener('submit', event => {
    event.preventDefault();
    if (authPending) return;
    const form = new FormData(signInForm);
    setBusy(true);
    feedback.textContent = '';
    void signIn({ username: usernameOf(signInForm), password: String(form.get('password') ?? '') })
      .then(value => { signInForm.reset(); acceptProfile(value); }).catch(error => { feedback.textContent = errorText(error); })
      .finally(() => setBusy(false));
  });
  registerForm.addEventListener('submit', event => {
    event.preventDefault();
    if (authPending) return;
    const form = new FormData(registerForm);
    const password = String(form.get('password') ?? '');
    if (password !== String(form.get('confirmPassword') ?? '')) {
      feedback.textContent = '两次输入的密码不一致。';
      return;
    }
    const input = {
      username: usernameOf(registerForm), password,
      displayName: String(form.get('displayName') ?? '').trim(),
      ...(String(form.get('registrationCode') ?? '').trim() ? { registrationCode: String(form.get('registrationCode')).trim() } : {}),
    };
    setBusy(true);
    feedback.textContent = '';
    void registerAccount(input).then(value => { registerForm.reset(); acceptProfile(value); }).catch(error => { feedback.textContent = errorText(error); })
      .finally(() => setBusy(false));
  });
  required<HTMLButtonElement>('sign-out').addEventListener('click', () => {
    const button = required<HTMLButtonElement>('sign-out');
    button.disabled = true;
    void signOut().then(() => acceptProfile(undefined)).catch(error => { feedback.textContent = errorText(error); })
      .finally(() => { button.disabled = false; });
  });
  required<HTMLButtonElement>('open-admin').addEventListener('click', () => { adminDialog.showModal(); void refreshUsers(); });
  required<HTMLButtonElement>('close-admin').addEventListener('click', () => adminDialog.close());

  const passwordDialog = required<HTMLDialogElement>('password-dialog');
  required<HTMLButtonElement>('open-password').addEventListener('click', () => passwordDialog.showModal());
  required<HTMLButtonElement>('close-password').addEventListener('click', () => passwordDialog.close());
  required<HTMLFormElement>('password-form').addEventListener('submit', event => {
    event.preventDefault();
    const form = event.currentTarget as HTMLFormElement;
    const values = new FormData(form);
    const next = String(values.get('newPassword') ?? '');
    const output = required<HTMLElement>('password-feedback');
    if (next !== String(values.get('confirmPassword') ?? '')) { output.textContent = '两次输入的新密码不一致。'; return; }
    const submit = form.querySelector<HTMLButtonElement>('button[type="submit"]');
    if (submit?.disabled) return;
    if (submit) submit.disabled = true;
    void changePassword(String(values.get('currentPassword') ?? ''), next).then(() => {
      output.textContent = '密码已修改，所有会话已退出。请重新登录。';
      form.reset();
      window.setTimeout(() => { passwordDialog.close(); acceptProfile(undefined); }, 900);
    }).catch(error => { output.textContent = errorText(error); })
      .finally(() => { if (submit) submit.disabled = false; });
  });

  const resetForm = required<HTMLFormElement>('reset-password-form');
  resetForm.addEventListener('submit', event => {
    event.preventDefault();
    const values = new FormData(resetForm);
    const password = String(values.get('newPassword') ?? '');
    const output = required<HTMLElement>('reset-password-feedback');
    if (password !== String(values.get('confirmPassword') ?? '')) { output.textContent = '两次输入的密码不一致。'; return; }
    if (!resetToken) return;
    const submit = resetForm.querySelector<HTMLButtonElement>('button[type="submit"]');
    if (submit?.disabled) return;
    if (submit) submit.disabled = true;
    void resetPassword(resetToken, password).then(() => {
      resetToken = undefined;
      delete document.body.dataset.resetActive;
      resetForm.reset();
      output.textContent = '密码已重置，请登录。';
      showMode('sign-in');
      return loadProfile().then(acceptProfile);
    }).catch(error => { output.textContent = errorText(error); })
      .finally(() => { if (submit) submit.disabled = false; });
  });

  const createForm = required<HTMLFormElement>('admin-create-form');
  createForm.addEventListener('submit', event => {
    event.preventDefault();
    const values = new FormData(createForm);
    void createAdminUser({
      username: String(values.get('username') ?? '').trim(),
      password: String(values.get('password') ?? ''),
      displayName: String(values.get('displayName') ?? '').trim(),
    }).then(async () => { createForm.reset(); required<HTMLElement>('admin-feedback').textContent = '账号已创建。'; await refreshUsers(); })
      .catch(error => { required<HTMLElement>('admin-feedback').textContent = errorText(error); });
  });

  async function refreshUsers() {
    const list = required<HTMLElement>('admin-users');
    list.textContent = '正在读取账号…';
    try {
      const users = await listAdminUsers();
      const rows = users.map(user => renderUser(user));
      list.replaceChildren(...rows);
    } catch (error) { list.textContent = errorText(error); }
  }
  function renderUser(user: AdminUser): HTMLElement {
    const row = document.createElement('article');
    row.className = 'admin-user';
    const preview = document.createElement('canvas');
    preview.width = 16; preview.height = 24; preview.className = 'admin-user-preview';
    const identity = document.createElement('div');
    identity.className = 'admin-user-identity';
    const name = document.createElement('strong'); name.textContent = user.displayName ?? user.name;
    const details = document.createElement('small'); details.textContent = `@${user.username ?? '匿名'} · ${user.role === 'admin' ? '管理员' : '成员'} · ${user.suspended ? '已冻结' : '正常'}`;
    identity.append(name, details);
    const actions = document.createElement('div'); actions.className = 'admin-user-actions';
    const canDelete = user.id !== profile?.id;
    const candidates: Array<{ action: AdminAction; label: string; confirm: string; hidden?: boolean }> = [
      { action: user.role === 'admin' ? 'demote' : 'promote', label: user.role === 'admin' ? '降为成员' : '设为管理员', confirm: `确认${user.role === 'admin' ? '降级' : '提升'} ${user.displayName ?? user.name}？`, hidden: user.id === profile?.id && user.role === 'admin' },
      { action: user.suspended ? 'unsuspend' : 'suspend', label: user.suspended ? '解除冻结' : '冻结', confirm: user.suspended
        ? `确认解除账号 ${user.displayName ?? user.name} 的冻结？`
        : `确认冻结账号 ${user.displayName ?? user.name}？此操作会让该账号退出所有设备上的会话。`, hidden: user.id === profile?.id && !user.suspended },
      { action: 'reset-password', label: '生成重置链接', confirm: `为 ${user.displayName ?? user.name} 生成一次性重置链接？生成链接不会退出其当前会话，完成密码重置后才会撤销全部会话。` },
      { action: 'kick', label: '踢下线', confirm: `确认让 ${user.displayName ?? user.name} 的所有设备下线？` },
      { action: 'delete', label: '删除', confirm: `确认永久删除账号 ${user.displayName ?? user.name}？`, hidden: !canDelete },
    ];
    for (const candidate of candidates) {
      if (candidate.hidden) continue;
      const button = document.createElement('button');
      button.type = 'button'; button.className = candidate.action === 'delete' ? 'danger' : 'secondary'; button.textContent = candidate.label;
      button.addEventListener('click', () => {
        if (!window.confirm(candidate.confirm)) return;
        button.disabled = true;
        void adminUserAction(user.id, candidate.action).then(async result => {
          if (candidate.action === 'reset-password' && 'url' in result) {
            const output = required<HTMLElement>('admin-feedback');
            const destination = new URL(result.url, location.origin);
            if (!['http:', 'https:'].includes(destination.protocol)) {
              throw new Error('服务器返回的重置链接无效');
            }
            const link = document.createElement('a'); link.href = destination.href; link.rel = 'noreferrer'; link.textContent = destination.href;
            output.replaceChildren(document.createTextNode('一次性重置链接（仅显示一次）： '), link);
          }
          if ((candidate.action === 'promote' || candidate.action === 'demote') && 'role' in result && result.id === profile?.id) acceptProfile(result);
          await refreshUsers();
        }).catch(error => { required<HTMLElement>('admin-feedback').textContent = errorText(error); button.disabled = false; });
      });
      actions.append(button);
    }
    row.append(preview, identity, actions);
    const appearance = appearanceSchema.safeParse(user.currentAppearance ?? user.appearance);
    if (appearance.success) void drawAppearancePreview(preview, appearance.data).catch(() => {});
    return row;
  }

  const fragmentMatch = location.hash.match(/^#reset-password=(.+)$/);
  if (fragmentMatch?.[1]) {
    try { resetToken = decodeURIComponent(fragmentMatch[1]); }
    catch { resetToken = fragmentMatch[1]; }
    document.body.dataset.resetActive = 'true';
    history.replaceState(null, '', `/login${location.search}`);
    document.body.classList.add('login-route');
    window.dispatchEvent(new Event('login-route-change'));
    renderStatus();
  }
  void registrationMode().then(updateRegistrationMode).catch(error => { required<HTMLElement>('registration-note').textContent = errorText(error); });
  const ready = loadProfile().then(value => { acceptProfile(value); return value; }).catch(error => {
    feedback.textContent = errorText(error);
    throw error;
  });
  return {
    getProfile: () => profile,
    ready,
    syncProfile(value: Profile | undefined) { profile = value; renderStatus(); },
    async refreshProfile() {
      const value = await loadProfile();
      acceptProfile(value);
      return value;
    },
  };
}
