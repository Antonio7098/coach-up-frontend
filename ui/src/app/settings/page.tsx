import { useState } from 'react';
import { useQuery, useMutation } from 'convex/react';
import { api } from '@/convex/_generated/api';

export default function SettingsPage() {
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
        } else {
          setGoalErrors({ general: error.message });
        }
      }
    }
  };

  return (
    <main className="min-h-screen bg-background text-foreground p-6">
      <div className="max-w-2xl mx-auto">
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        
        {/* Profile Section */}
        <section className="mt-8">
          <h2 className="text-xl font-medium">Profile</h2>
          <form onSubmit={handleProfileSubmit} className="mt-4 space-y-4">
            {profileErrors.general && (
              <div className="text-red-500 text-sm">{profileErrors.general}</div>
            )}
            
            <div>
              <label className="block text-sm font-medium">Display Name</label>
              <input
                value={profileForm.displayName}
                onChange={(e) => setProfileForm({...profileForm, displayName: e.target.value})}
                className="mt-1 w-full cu-input"
              />
              {profileErrors.displayName && (
                <div className="text-red-500 text-sm mt-1">{profileErrors.displayName}</div>
              )}
            </div>
            
            <div>
              <label className="block text-sm font-medium">Email</label>
              <input
                type="email"
                value={profileForm.email}
                onChange={(e) => setProfileForm({...profileForm, email: e.target.value})}
                className="mt-1 w-full cu-input"
              />
              {profileErrors.email && (
                <div className="text-red-500 text-sm mt-1">{profileErrors.email}</div>
              )}
            </div>
            
            <div>
              <label className="block text-sm font-medium">Avatar URL</label>
              <input
                value={profileForm.avatarUrl}
                onChange={(e) => setProfileForm({...profileForm, avatarUrl: e.target.value})}
                className="mt-1 w-full cu-input"
              />
              {profileErrors.avatarUrl && (
                <div className="text-red-500 text-sm mt-1">{profileErrors.avatarUrl}</div>
              )}
            </div>
            
            <div>
              <label className="block text-sm font-medium">Bio</label>
              <textarea
                value={profileForm.bio}
                onChange={(e) => setProfileForm({...profileForm, bio: e.target.value})}
                className="mt-1 w-full cu-input"
              />
              {profileErrors.bio && (
                <div className="text-red-500 text-sm mt-1">{profileErrors.bio}</div>
              )}
            </div>
            
            <button 
              type="submit" 
              className="cu-button-primary"
            >
              Save Profile
            </button>
          </form>
        </section>
        
        {/* Goals Section */}
        <section className="mt-8">
          <h2 className="text-xl font-medium">Goals</h2>
          <form onSubmit={handleGoalSubmit} className="mt-4 space-y-4">
            {goalErrors.general && (
              <div className="text-red-500 text-sm">{goalErrors.general}</div>
            )}
            
            <div>
              <label className="block text-sm font-medium">Title</label>
              <input
                value={goalForm.title}
                onChange={(e) => setGoalForm({...goalForm, title: e.target.value})}
                className="mt-1 w-full cu-input"
              />
              {goalErrors.title && (
                <div className="text-red-500 text-sm mt-1">{goalErrors.title}</div>
              )}
            </div>
            
            <div>
              <label className="block text-sm font-medium">Description</label>
              <textarea
                value={goalForm.description}
                onChange={(e) => setGoalForm({...goalForm, description: e.target.value})}
                className="mt-1 w-full cu-input"
              />
            </div>
            
            <div>
              <label className="block text-sm font-medium">Status</label>
              <select
                value={goalForm.status}
                onChange={(e) => setGoalForm({...goalForm, status: e.target.value as 'active' | 'paused' | 'completed'})}
                className="mt-1 w-full cu-input"
              >
                <option value="active">Active</option>
                <option value="paused">Paused</option>
                <option value="completed">Completed</option>
              </select>
            </div>
            
            <div>
              <label className="block text-sm font-medium">Target Date</label>
              <input
                type="date"
                value={new Date(goalForm.targetDateMs).toISOString().split('T')[0]}
                onChange={(e) => setGoalForm({...goalForm, targetDateMs: new Date(e.target.value).getTime()})}
                className="mt-1 w-full cu-input"
              />
            </div>
            
            <div>
              <label className="block text-sm font-medium">Tags</label>
              <input
                value={goalForm.tags.join(', ')}
                onChange={(e) => setGoalForm({...goalForm, tags: e.target.value.split(', ')})}
                className="mt-1 w-full cu-input"
              />
            </div>
            
            <button 
              type="submit" 
              className="cu-button-primary"
            >
              Save Goal
            </button>
          </form>
        </section>
        
      </div>
    </main>
  );
}
