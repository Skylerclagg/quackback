import { useState, useRef, useEffect } from 'react'
import { toast } from 'sonner'
import { CameraIcon, ArrowPathIcon, TrashIcon } from '@heroicons/react/24/solid'
import { useQuery, useSuspenseQuery } from '@tanstack/react-query'
import type { UserId } from '@quackback/ids'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Avatar } from '@/components/ui/avatar'
import { ImageCropper } from '@/components/ui/image-cropper'
import { authClient } from '@/lib/client/auth-client'
import { useRouter } from '@tanstack/react-router'
import { updateProfileNameFn } from '@/lib/server/functions/user'
import { getMyNameStatusFn, updateMyNameFn } from '@/lib/server/functions/profile-name'
import { nameStatusQueryKey } from '@/components/portal/name-prompt'
import { describeNameWriteBack } from '@/lib/shared/entra-writeback-message'
import { useUploadAvatar, useDeleteAvatar } from '@/lib/client/mutations/avatar'
import { settingsQueries } from '@/lib/client/queries/settings'
import { PasswordForm } from '@/components/settings/password-form'
import { EmailField } from '@/components/settings/email-field'

interface ProfileFormProps {
  user: {
    id: string
    name: string
    email: string | null
  }
}

export function ProfileForm({ user }: ProfileFormProps) {
  const router = useRouter()
  const userId = user.id as UserId

  // Avatar + auth-posture state from React Query. `hasPassword` is the
  // server's read of whether the user has a `credential` account row;
  // drives the Set-vs-Change shape of the password section without a
  // second client-side round-trip.
  const { data: profileData } = useSuspenseQuery(settingsQueries.userProfile(userId))
  const { avatarUrl, hasCustomAvatar, hasPassword, ssoEnforced } = profileData

  // Avatar mutations
  const uploadMutation = useUploadAvatar(userId)
  const deleteMutation = useDeleteAvatar(userId)

  const [name, setName] = useState(user.name)
  // First/last name live beside the display name; see profile-name.ts.
  const { data: names } = useQuery({
    queryKey: nameStatusQueryKey,
    queryFn: () => getMyNameStatusFn(),
    staleTime: 5 * 60 * 1000,
  })
  const [givenName, setGivenName] = useState('')
  const [familyName, setFamilyName] = useState('')
  useEffect(() => {
    if (!names) return
    setGivenName(names.givenName ?? '')
    setFamilyName(names.familyName ?? '')
  }, [names])
  const [isSubmitting, setIsSubmitting] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Cropper state
  const [showCropper, setShowCropper] = useState(false)
  const [cropImageSrc, setCropImageSrc] = useState<string | null>(null)

  const handleAvatarClick = () => {
    fileInputRef.current?.click()
  }

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    // Validate file type
    const allowedTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp']
    if (!allowedTypes.includes(file.type)) {
      toast.error('Invalid file type. Allowed: JPEG, PNG, GIF, WebP')
      return
    }

    // Validate file size (5MB) - basic check before cropping
    if (file.size > 5 * 1024 * 1024) {
      toast.error('File too large. Maximum size is 5MB')
      return
    }

    // Create URL for cropper and show modal
    const imageUrl = URL.createObjectURL(file)
    setCropImageSrc(imageUrl)
    setShowCropper(true)

    // Reset file input for re-selection
    if (fileInputRef.current) {
      fileInputRef.current.value = ''
    }
  }

  const handleCropComplete = (croppedBlob: Blob) => {
    if (cropImageSrc) {
      URL.revokeObjectURL(cropImageSrc)
      setCropImageSrc(null)
    }

    uploadMutation.mutate(croppedBlob, {
      onSuccess: () => {
        router.invalidate()
        toast.success('Avatar updated')
      },
      onError: (error) => {
        toast.error(error instanceof Error ? error.message : 'Failed to upload avatar')
      },
    })
  }

  const handleCropperClose = (open: boolean) => {
    if (!open && cropImageSrc) {
      URL.revokeObjectURL(cropImageSrc)
      setCropImageSrc(null)
    }
    setShowCropper(open)
  }

  const handleDeleteAvatar = () => {
    deleteMutation.mutate(undefined, {
      onSuccess: () => {
        router.invalidate()
        toast.success('Avatar removed')
      },
      onError: (error) => {
        toast.error(error instanceof Error ? error.message : 'Failed to remove avatar')
      },
    })
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    if (name.trim().length < 2) {
      toast.error('Display name must be at least 2 characters')
      return
    }

    const displayNameChanged = name.trim() !== user.name
    const partsChanged =
      givenName.trim() !== (names?.givenName ?? '') ||
      familyName.trim() !== (names?.familyName ?? '')
    if (!displayNameChanged && !partsChanged) {
      toast.info('No changes to save')
      return
    }
    if (partsChanged && (!givenName.trim() || !familyName.trim())) {
      toast.error('Enter both a first and a last name')
      return
    }

    setIsSubmitting(true)

    try {
      if (displayNameChanged) {
        await updateProfileNameFn({ data: { name: name.trim() } })

        // Update better-auth session with new name
        await authClient.updateUser(
          { name: name.trim() },
          {
            onSuccess: () => {
              router.invalidate()
            },
          }
        )
      }
      if (partsChanged) {
        // First/last name; for Entra accounts this also updates the person's
        // own directory profile, and the toast says whether it did.
        const result = await updateMyNameFn({
          data: { givenName: givenName.trim(), familyName: familyName.trim() },
        })
        toast.success(describeNameWriteBack(result.entra))
      } else {
        toast.success('Profile updated')
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to update profile')
    } finally {
      setIsSubmitting(false)
    }
  }

  const isUploadingAvatar = uploadMutation.isPending
  const isDeletingAvatar = deleteMutation.isPending

  return (
    <div className="space-y-6">
      {/* Avatar Section */}
      <div className="rounded-xl border border-border/50 bg-card p-6 shadow-sm">
        <h2 className="font-medium mb-1">Avatar</h2>
        <p className="text-sm text-muted-foreground mb-4">Your profile picture</p>
        <div className="flex items-center gap-4">
          <div className="relative group">
            <Avatar className="h-16 w-16" src={avatarUrl} name={name} fallbackClassName="text-lg" />
            {isUploadingAvatar && (
              <div className="absolute inset-0 flex items-center justify-center bg-black/50 rounded-full">
                <ArrowPathIcon className="h-6 w-6 animate-spin text-white" />
              </div>
            )}
          </div>
          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={handleAvatarClick}
              disabled={isUploadingAvatar}
            >
              {isUploadingAvatar ? (
                <>
                  <ArrowPathIcon className="h-4 w-4 animate-spin mr-2" />
                  Uploading...
                </>
              ) : (
                <>
                  <CameraIcon className="h-4 w-4 mr-2" />
                  Change avatar
                </>
              )}
            </Button>
            {hasCustomAvatar && (
              <Button
                type="button"
                variant="outline"
                onClick={handleDeleteAvatar}
                disabled={isDeletingAvatar}
                className="text-destructive hover:text-destructive"
              >
                {isDeletingAvatar ? (
                  <ArrowPathIcon className="h-4 w-4 animate-spin" />
                ) : (
                  <TrashIcon className="h-4 w-4" />
                )}
              </Button>
            )}
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/jpeg,image/png,image/gif,image/webp"
            onChange={handleFileChange}
            className="hidden"
          />
        </div>
      </div>

      {/* Personal Information */}
      <form onSubmit={handleSubmit}>
        <div className="rounded-xl border border-border/50 bg-card p-6 shadow-sm">
          <h2 className="font-medium mb-1">Personal Information</h2>
          <p className="text-sm text-muted-foreground mb-4">Update your personal details</p>
          <div className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <label htmlFor="name" className="text-sm font-medium">
                  Display name
                </label>
                <Input
                  id="name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  disabled={isSubmitting}
                />
              </div>
              <EmailField />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <label htmlFor="given-name" className="text-sm font-medium">
                  First name
                </label>
                <Input
                  id="given-name"
                  value={givenName}
                  onChange={(e) => setGivenName(e.target.value)}
                  autoComplete="given-name"
                  maxLength={64}
                  disabled={isSubmitting || !names}
                />
              </div>
              <div className="space-y-2">
                <label htmlFor="family-name" className="text-sm font-medium">
                  Last name
                </label>
                <Input
                  id="family-name"
                  value={familyName}
                  onChange={(e) => setFamilyName(e.target.value)}
                  autoComplete="family-name"
                  maxLength={64}
                  disabled={isSubmitting || !names}
                />
              </div>
            </div>
            <div className="flex justify-end">
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting ? (
                  <>
                    <ArrowPathIcon className="h-4 w-4 animate-spin mr-2" />
                    Saving...
                  </>
                ) : (
                  'Save changes'
                )}
              </Button>
            </div>
          </div>
        </div>
      </form>

      {/* Password — hidden for SSO-enforced users (the IdP manages the
       *  credential; surfacing a password form would be misleading). */}
      {!ssoEnforced && (
        <PasswordForm hasPassword={hasPassword} onSaved={() => router.invalidate()} />
      )}

      {/* Image Cropper Modal */}
      {cropImageSrc && (
        <ImageCropper
          imageSrc={cropImageSrc}
          open={showCropper}
          onOpenChange={handleCropperClose}
          onCropComplete={handleCropComplete}
        />
      )}
    </div>
  )
}
