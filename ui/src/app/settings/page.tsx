"use client";
import { useState } from 'react';
import { useQuery, useMutation } from 'convex/react';
import { api } from '@/convex/_generated/api';

export default function SettingsPage() {
  const isMock = process.env.NEXT_PUBLIC_MOCK_CONVEX === '1';

  if (isMock) {
    // Mocked UI: local-only state, no Convex calls
    const [profileForm, setProfileForm] = useState({
      displayName: '',
      email: '',
      avatarUrl: '',
      bio: '',
    });
    const [goalForm, setGoalForm] = useState({
      title: '',
      description: '',
      status: 'active' as 'active' | 'paused' | 'completed',
      targetDateMs: Date.now() + 30 * 24 * 60 * 60 * 1000,
      tags: [] as string[],
    });
    const [profileErrors, setProfileErrors] = useState<Record<string, string>>({});
    const [goalErrors, setGoalErrors] = useState<Record<string, string>>({});

    const handleProfileSubmit = (e: React.FormEvent) => {
      e.preventDefault();
      setProfileErrors({});
      // pretend success
    };
    const handleGoalSubmit = (e: React.FormEvent) => {
      e.preventDefault();
      setGoalErrors({});
      setGoalForm({ title: '', description: '', status: 'active', targetDateMs: Date.now() + 30 * 24 * 60 * 60 * 1000, tags: [] });
    };

    return (
      <main className="min-h-screen bg-background text-foreground">
        <div className="mx-auto w-full max-w-3xl px-6 py-8">
          <header className="mb-8">
            <h1 className="text-3xl font-semibold tracking-tight">Settings</h1>
            <p className="text-sm text-muted-foreground mt-1">You are viewing mocked data. Turn off mocks to sync with your account.</p>
          </header>

          {/* Profile Card */}
          <section className="rounded-xl border bg-card p-6 shadow-sm">
            <div className="mb-4">
              <h2 className="text-lg font-medium">Profile</h2>
              <p className="text-sm text-muted-foreground">Update how your name and details appear.</p>
            </div>
            <form onSubmit={handleProfileSubmit} className="grid gap-4">
              <div className="grid gap-1">
                <label className="text-sm font-medium">Display Name</label>
                <input
                  placeholder="Jane Doe"
                  value={profileForm.displayName}
                  onChange={(e) => setProfileForm({ ...profileForm, displayName: e.target.value })}
                  className="mt-1 w-full cu-input"
                />
              </div>
              <div className="grid gap-1">
                <label className="text-sm font-medium">Email</label>
                <input
                  type="email"
                  placeholder="jane@example.com"
                  value={profileForm.email}
                  onChange={(e) => setProfileForm({ ...profileForm, email: e.target.value })}
                  className="mt-1 w-full cu-input"
                />
              </div>
              <div className="grid gap-1">
                <label className="text-sm font-medium">Avatar URL</label>
                <input
                  placeholder="https://..."
                  value={profileForm.avatarUrl}
                  onChange={(e) => setProfileForm({ ...profileForm, avatarUrl: e.target.value })}
                  className="mt-1 w-full cu-input"
                />
              </div>
              <div className="grid gap-1">
                <label className="text-sm font-medium">Bio</label>
                <textarea
                  placeholder="A short bio about you"
                  value={profileForm.bio}
                  onChange={(e) => setProfileForm({ ...profileForm, bio: e.target.value })}
                  className="mt-1 w-full cu-input min-h-24"
                />
              </div>
              <div className="flex items-center justify-end gap-3 pt-2">
                <button type="submit" className="cu-button-primary">Save changes</button>
              </div>
            </form>
          </section>

          {/* Goals Card */}
          <section className="mt-8 rounded-xl border bg-card p-6 shadow-sm">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <h2 className="text-lg font-medium">Goals</h2>
                <p className="text-sm text-muted-foreground">Track what you’re working toward.</p>
              </div>
            </div>
            <form onSubmit={handleGoalSubmit} className="grid gap-4">
              <div className="grid gap-1">
                <label className="text-sm font-medium">Title</label>
                <input
                  placeholder="e.g. Improve clarity"
                  value={goalForm.title}
                  onChange={(e) => setGoalForm({ ...goalForm, title: e.target.value })}
                  className="mt-1 w-full cu-input"
                />
              </div>
              <div className="grid gap-1">
                <label className="text-sm font-medium">Description</label>
                <textarea
                  placeholder="What success looks like, examples, etc."
                  value={goalForm.description}
                  onChange={(e) => setGoalForm({ ...goalForm, description: e.target.value })}
                  className="mt-1 w-full cu-input min-h-24"
                />
              </div>
              <div className="grid gap-4 md:grid-cols-3">
                <div className="grid gap-1">
                  <label className="text-sm font-medium">Status</label>
                  <select
                    value={goalForm.status}
                    onChange={(e) => setGoalForm({ ...goalForm, status: e.target.value as 'active' | 'paused' | 'completed' })}
                    className="mt-1 w-full cu-input"
                  >
                    <option value="active">Active</option>
                    <option value="paused">Paused</option>
                    <option value="completed">Completed</option>
                  </select>
                </div>
                <div className="grid gap-1">
                  <label className="text-sm font-medium">Target Date</label>
                  <input
                    type="date"
                    value={new Date(goalForm.targetDateMs).toISOString().split('T')[0]}
                    onChange={(e) => setGoalForm({ ...goalForm, targetDateMs: new Date(e.target.value).getTime() })}
                    className="mt-1 w-full cu-input"
                  />
                </div>
                <div className="grid gap-1">
                  <label className="text-sm font-medium">Tags</label>
                  <input
                    placeholder="comma separated"
                    value={goalForm.tags.join(', ')}
                    onChange={(e) => setGoalForm({ ...goalForm, tags: e.target.value.split(',').map(t => t.trim()).filter(Boolean) })}
                    className="mt-1 w-full cu-input"
                  />
                </div>
              </div>
              <div className="flex items-center justify-end gap-3 pt-2">
                <button type="submit" className="cu-button-primary">Save goal</button>
              </div>
            </form>
          </section>
        </div>
      </main>
    );
  }

  const profile = useQuery(api.profile.getUserProfile);
  const goals = useQuery(api.goals.getUserGoals);
  
  const updateProfile = useMutation(api.profile.updateUserProfile);
  const createGoalMutation = useMutation(api.goals.createGoal);
  const updateGoalMutation = useMutation(api.goals.updateGoal);
  const deleteGoalMutation = useMutation(api.goals.deleteGoal);
  
  const [profileForm, setProfileForm] = useState({
    displayName: profile?.displayName || '',
    email: profile?.email || '',
    avatarUrl: profile?.avatarUrl || '',
    bio: profile?.bio || '',
  });
  
  const [profileErrors, setProfileErrors] = useState<Record<string, string>>({});

  const [goalForm, setGoalForm] = useState({
    title: '',
    description: '',
    status: 'active' as 'active' | 'paused' | 'completed',
    targetDateMs: Date.now() + 30 * 24 * 60 * 60 * 1000, // 30 days from now
    tags: [] as string[],
  });
  
  const [editingGoalId, setEditingGoalId] = useState<string | null>(null);
  const [goalErrors, setGoalErrors] = useState<Record<string, string>>({});

  const handleProfileSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setProfileErrors({});
    
    try {
      await updateProfile(profileForm);
    } catch (error) {
      if (error instanceof Error) {
        // Simple error mapping - in real app you'd parse error message
        if (error.message.includes('Display name')) {
          setProfileErrors({ displayName: error.message });
        } else if (error.message.includes('email')) {
          setProfileErrors({ email: error.message });
        } else if (error.message.includes('Bio')) {
          setProfileErrors({ bio: error.message });
        } else {
          setProfileErrors({ general: error.message });
        }
      }
    }
  };

  const handleGoalSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setGoalErrors({});
    
    try {
      if (editingGoalId) {
        await updateGoalMutation({ goalId: editingGoalId, ...goalForm });
      } else {
        await createGoalMutation(goalForm);
      }
      // Reset form
      setGoalForm({
        title: '',
        description: '',
        status: 'active',
        targetDateMs: Date.now() + 30 * 24 * 60 * 60 * 1000,
        tags: [],
      });
      setEditingGoalId(null);
    } catch (error) {
      if (error instanceof Error) {
        if (error.message.includes('Title')) {
          setGoalErrors({ title: error.message });
        } else if (error.message.includes('Description')) {
          setGoalErrors({ description: error.message });
        } else if (error.message.includes('Status')) {
          setGoalErrors({ status: error.message });
        } else if (error.message.includes('Target Date')) {
          setGoalErrors({ targetDateMs: error.message });
        } else if (error.message.includes('Tags')) {
          setGoalErrors({ tags: error.message });
        } else {
          setGoalErrors({ general: error.message });
        }
      }
    }
  };

  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="mx-auto w-full max-w-3xl px-6 py-8">
        <header className="mb-8">
          <h1 className="text-3xl font-semibold tracking-tight">Settings</h1>
          <p className="text-sm text-muted-foreground mt-1">Manage your profile and goals.</p>
        </header>

        {/* Profile Card */}
        <section className="rounded-xl border bg-card p-6 shadow-sm">
          <div className="mb-4">
            <h2 className="text-lg font-medium">Profile</h2>
            <p className="text-sm text-muted-foreground">Update how your name and details appear.</p>
          </div>
          <form onSubmit={handleProfileSubmit} className="grid gap-4">
            {profileErrors.general && (
              <div className="text-red-500 text-sm">{profileErrors.general}</div>
            )}
            <div className="grid gap-1">
              <label className="text-sm font-medium">Display Name</label>
              <input
                placeholder="Jane Doe"
                value={profileForm.displayName}
                onChange={(e) => setProfileForm({ ...profileForm, displayName: e.target.value })}
                className="mt-1 w-full cu-input"
              />
              {profileErrors.displayName && (
                <div className="text-red-500 text-sm mt-1">{profileErrors.displayName}</div>
              )}
            </div>
            <div className="grid gap-1">
              <label className="text-sm font-medium">Email</label>
              <input
                type="email"
                placeholder="jane@example.com"
                value={profileForm.email}
                onChange={(e) => setProfileForm({ ...profileForm, email: e.target.value })}
                className="mt-1 w-full cu-input"
              />
              {profileErrors.email && (
                <div className="text-red-500 text-sm mt-1">{profileErrors.email}</div>
              )}
            </div>
            <div className="grid gap-1">
              <label className="text-sm font-medium">Avatar URL</label>
              <input
                placeholder="https://..."
                value={profileForm.avatarUrl}
                onChange={(e) => setProfileForm({ ...profileForm, avatarUrl: e.target.value })}
                className="mt-1 w-full cu-input"
              />
              {profileErrors.avatarUrl && (
                <div className="text-red-500 text-sm mt-1">{profileErrors.avatarUrl}</div>
              )}
            </div>
            <div className="grid gap-1">
              <label className="text-sm font-medium">Bio</label>
              <textarea
                placeholder="A short bio about you"
                value={profileForm.bio}
                onChange={(e) => setProfileForm({ ...profileForm, bio: e.target.value })}
                className="mt-1 w-full cu-input min-h-24"
              />
              {profileErrors.bio && (
                <div className="text-red-500 text-sm mt-1">{profileErrors.bio}</div>
              )}
            </div>
            <div className="flex items-center justify-end gap-3 pt-2">
              <button 
                type="submit" 
                className="cu-button-primary"
              >
                Save changes
              </button>
            </div>
          </form>
        </section>

        {/* Goals Card */}
        <section className="mt-8 rounded-xl border bg-card p-6 shadow-sm">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h2 className="text-lg font-medium">Goals</h2>
              <p className="text-sm text-muted-foreground">Track what you’re working toward.</p>
            </div>
          </div>
          <form onSubmit={handleGoalSubmit} className="grid gap-4">
            {goalErrors.general && (
              <div className="text-red-500 text-sm">{goalErrors.general}</div>
            )}
            <div className="grid gap-1">
              <label className="text-sm font-medium">Title</label>
              <input
                placeholder="e.g. Improve clarity"
                value={goalForm.title}
                onChange={(e) => setGoalForm({ ...goalForm, title: e.target.value })}
                className="mt-1 w-full cu-input"
              />
              {goalErrors.title && (
                <div className="text-red-500 text-sm mt-1">{goalErrors.title}</div>
              )}
            </div>
            <div className="grid gap-1">
              <label className="text-sm font-medium">Description</label>
              <textarea
                placeholder="What success looks like, examples, etc."
                value={goalForm.description}
                onChange={(e) => setGoalForm({ ...goalForm, description: e.target.value })}
                className="mt-1 w-full cu-input min-h-24"
              />
              {goalErrors.description && (
                <div className="text-red-500 text-sm mt-1">{goalErrors.description}</div>
              )}
            </div>
            <div className="grid gap-4 md:grid-cols-3">
              <div className="grid gap-1">
                <label className="text-sm font-medium">Status</label>
                <select
                  value={goalForm.status}
                  onChange={(e) => setGoalForm({ ...goalForm, status: e.target.value as 'active' | 'paused' | 'completed' })}
                  className="mt-1 w-full cu-input"
                >
                  <option value="active">Active</option>
                  <option value="paused">Paused</option>
                  <option value="completed">Completed</option>
                </select>
                {goalErrors.status && (
                  <div className="text-red-500 text-sm mt-1">{goalErrors.status}</div>
                )}
              </div>
              <div className="grid gap-1">
                <label className="text-sm font-medium">Target Date</label>
                <input
                  type="date"
                  value={new Date(goalForm.targetDateMs).toISOString().split('T')[0]}
                  onChange={(e) => setGoalForm({ ...goalForm, targetDateMs: new Date(e.target.value).getTime() })}
                  className="mt-1 w-full cu-input"
                />
                {goalErrors.targetDateMs && (
                  <div className="text-red-500 text-sm mt-1">{goalErrors.targetDateMs}</div>
                )}
              </div>
              <div className="grid gap-1">
                <label className="text-sm font-medium">Tags</label>
                <input
                  placeholder="comma separated"
                  value={goalForm.tags.join(', ')}
                  onChange={(e) => setGoalForm({ ...goalForm, tags: e.target.value.split(',').map(t => t.trim()).filter(Boolean) })}
                  className="mt-1 w-full cu-input"
                />
                {goalErrors.tags && (
                  <div className="text-red-500 text-sm mt-1">{goalErrors.tags}</div>
                )}
              </div>
            </div>
            <div className="flex items-center justify-end gap-3 pt-2">
              <button 
                type="submit" 
                className="cu-button-primary"
              >
                Save goal
              </button>
            </div>
          </form>

          {/* Existing goals list */}
          <div className="mt-6 grid gap-3">
            {goals?.length ? (
              goals.map((g: any) => (
                <div key={g._id} className="flex items-start justify-between rounded-lg border bg-background p-4">
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="font-medium">{g.title}</h3>
                      <span className="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-xs capitalize">{g.status}</span>
                    </div>
                    {g.description ? (
                      <p className="mt-1 text-sm text-muted-foreground">{g.description}</p>
                    ) : null}
                    {g.tags?.length ? (
                      <div className="mt-2 flex flex-wrap gap-1">
                        {g.tags.map((t: string) => (
                          <span key={t} className="rounded-md bg-muted px-2 py-0.5 text-xs">{t}</span>
                        ))}
                      </div>
                    ) : null}
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setEditingGoalId(g.goalId);
                        setGoalForm({
                          title: g.title,
                          description: g.description || '',
                          status: g.status,
                          targetDateMs: g.targetDateMs || Date.now(),
                          tags: g.tags || [],
                        });
                      }}
                      className="cu-button-secondary"
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      onClick={() => deleteGoalMutation({ goalId: g.goalId })}
                      className="cu-button-danger"
                    >
                      Delete
                    </button>
                  </div>
                </div>
              ))
            ) : (
              <p className="text-sm text-muted-foreground">No goals yet. Create your first goal above.</p>
            )}
          </div>
        </section>
      </div>
    </main>
  );
}
