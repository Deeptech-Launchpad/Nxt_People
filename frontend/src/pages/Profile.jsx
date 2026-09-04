import React, { useState, useEffect, useRef } from 'react';
import { Pencil, X, Eye, EyeOff, Key, Camera, Trash2, Check } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import api from '../utils/api';
import toast from 'react-hot-toast';
import { useAuth } from '../context/AuthContext';
import { roleLabel } from '../utils/roles';
import MfaSettingsCard from '../components/MfaSettingsCard';
import PhotoCropperModal from '../components/PhotoCropperModal';

/* ── helpers ──────────────────────────────────────────────────────────────── */

const fmtDate = (iso) =>
  iso ? new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '-';

/** Single field row — label on the left, value on the right (Zoho style). */
const Row = ({ label, children }) => (
  <div className="grid grid-cols-[160px_1fr] gap-4 items-start py-3 border-b border-slate-100 last:border-b-0">
    <span className="text-[15px] text-slate-500">{label}</span>
    <span className="text-[15px] text-slate-800 font-medium break-words">
      {children == null || children === '' ? <span className="text-slate-300">-</span> : children}
    </span>
  </div>
);

/** Card section with title + a 2-column grid of rows. */
const Section = ({ title, children }) => (
  <section className="bg-white border border-slate-200 rounded-md">
    <h3 className="px-6 py-4 text-[17px] font-bold text-slate-800 border-b border-slate-100">
      {title}
    </h3>
    <div className="px-6 py-1 grid grid-cols-1 md:grid-cols-2 md:gap-x-12">
      {children}
    </div>
  </section>
);

/** The right-hand side of an EditableRow, in edit mode: a text box, a
 *  textarea, a select, or a date picker, depending on what the field is. */
const FieldInput = ({ type = 'text', value, onChange, options, placeholder, rows }) => {
  const cls = "w-full border border-slate-200 rounded-lg px-2.5 py-1.5 text-[14px] "
    + "focus:outline-none focus:border-blue-400 bg-white";
  if (type === 'textarea') {
    return (
      <textarea value={value || ''} onChange={e => onChange(e.target.value)} rows={rows || 2}
        placeholder={placeholder} className={`${cls} resize-none`} />
    );
  }
  if (type === 'select') {
    return (
      <select value={value || ''} onChange={e => onChange(e.target.value)} className={cls}>
        <option value="">Select...</option>
        {options.map(o => <option key={o} value={o}>{o}</option>)}
      </select>
    );
  }
  return (
    <input type={type === 'date' ? 'date' : 'text'} value={value || ''}
      onChange={e => onChange(e.target.value)} placeholder={placeholder} className={cls} />
  );
};

/** A row that becomes an input while editing, and is plain text otherwise —
 *  the same field, the same position, so nothing jumps when edit mode toggles.
 *  Everything HR manages stays a `Row`, which never grows an input; that is
 *  what makes it read-only rather than a rule enforced by a note in a modal
 *  subtitle. */
const EditableRow = ({ label, editing, value, onChange, type, options, placeholder, display }) => (
  <div className="grid grid-cols-[160px_1fr] gap-4 items-start py-3 border-b border-slate-100 last:border-b-0">
    <span className="text-[15px] text-slate-500">{label}</span>
    <span className="text-[15px] text-slate-800 font-medium break-words">
      {editing
        ? <FieldInput type={type} value={value} onChange={onChange} options={options} placeholder={placeholder} />
        : (display !== undefined ? display
          : (value == null || value === '' ? <span className="text-slate-300">-</span> : value))}
    </span>
  </div>
);

/** Masked value with click-to-reveal — used for PAN, bank account, IFSC. */
const Masked = ({ value }) => {
  const [shown, setShown] = useState(false);
  if (!value) return null;
  return (
    <span className="inline-flex items-center gap-2">
      <span className="font-mono">{shown ? value : '*'.repeat(Math.max(8, String(value).length))}</span>
      <button
        type="button"
        onClick={() => setShown(s => !s)}
        className="text-slate-400 hover:text-slate-700"
        aria-label={shown ? 'Hide' : 'Reveal'}
      >
        {shown ? <EyeOff size={13} /> : <Eye size={13} />}
      </button>
    </span>
  );
};

/* ── page ──────────────────────────────────────────────────────────────────── */

export default function Profile() {
  const navigate = useNavigate();
  const { setUser } = useAuth();
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  /* Editing used to be a modal over the record — a short, disconnected form
   * bearing no visible relation to the forty-odd facts on the page behind it.
   * You could not tell, looking at the record, which five things the modal
   * would let you touch. Edit mode now happens IN the sections: the fields
   * you may change turn into inputs where they already sit, and the fields
   * HR manages stay exactly as printed, in place, because a `Row` never
   * becomes an input regardless of this flag — that is what makes them
   * actually read-only rather than merely unmentioned in a modal's subtitle. */
  const [editing, setEditing] = useState(false);
  const [pwModal, setPwModal] = useState(false);
  const [form, setForm] = useState({});
  // Snapshot of `form` taken when editing starts — compared against on
  // Cancel, both to ask before discarding and to actually discard: the
  // inputs are controlled by `form`, so leaving stale edits in state would
  // have them reappear next time editing opens even after Cancel.
  const [formSnapshot, setFormSnapshot] = useState({});
  const [pwForm, setPwForm] = useState({ currentPassword: '', newPassword: '', confirmPassword: '' });
  const [saving, setSaving] = useState(false);

  const openEdit = () => {
    setFormSnapshot(form);
    setEditing(true);
  };
  const cancelEdit = () => {
    const dirty = JSON.stringify(form) !== JSON.stringify(formSnapshot);
    if (dirty && !window.confirm('You have unsaved changes. Discard them?')) return;
    setForm(formSnapshot);
    setEditing(false);
  };
  const set = (key, value) => setForm(f => ({ ...f, [key]: value }));

  const fileInputRef = useRef(null);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  // 0–100 % — drives the progress bar that overlays the avatar while a
  // large photo uploads. Without this users saw a frozen spinner with no
  // feedback for ~5 s on slow connections.
  const [uploadProgress, setUploadProgress] = useState(0);
  // Cropper modal owns its own pos/zoom/areaPixels — we only track the
  // image data URL that triggers it. When cropSrc is non-null the
  // PhotoCropperModal is open.
  const [cropSrc, setCropSrc] = useState(null);
  // Lightbox state — opens when the user clicks their profile photo
  // (the same UX as tapping your DP in WhatsApp / Instagram). Click
  // anywhere on the backdrop or press Escape to close.
  const [viewerOpen, setViewerOpen] = useState(false);
  useEffect(() => {
    if (!viewerOpen) return;
    const close = (e) => { if (e.key === 'Escape') setViewerOpen(false); };
    document.addEventListener('keydown', close);
    return () => document.removeEventListener('keydown', close);
  }, [viewerOpen]);

  /** Open the OS file picker programmatically. */
  const triggerPhotoPicker = () => fileInputRef.current?.click();

  /** Upload the chosen image to /api/profile/photo and refresh the profile. */
  // Step 1 — file picked. Validate, then read into a data URL and open
  // the cropper modal. The actual upload waits until the user confirms
  // the crop region (which lets them pick face area vs full body vs centred).
  const handlePhotoChange = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    // Backend allows up to PROFILE_PHOTO_MAX_MB = 10 MB. Stay in sync —
    // a stricter frontend rejection just confuses users who could
    // legitimately upload a higher-res photo.
    if (file.size > 10 * 1024 * 1024) {
      toast.error('Image must be 10 MB or smaller');
      e.target.value = '';
      return;
    }
    if (!/^image\//i.test(file.type)) {
      toast.error('Only image files are allowed');
      e.target.value = '';
      return;
    }
    const reader = new FileReader();
    reader.onload = () => setCropSrc(reader.result);
    reader.readAsDataURL(file);
    // Reset the file input so picking the same file again re-opens the cropper.
    e.target.value = '';
  };

  // Step 2 — cropper modal called us with the final JPEG blob. Upload it
  // and refresh the profile + auth context so every avatar re-renders.
  const handleCropSave = async (blob) => {
    if (!blob) return;
    setUploadingPhoto(true);
    setUploadProgress(0);
    try {
      const form = new FormData();
      form.append('photo', blob, 'profile.jpg');
      const r = await api.post('/profile/photo', form, {
        headers: { 'Content-Type': 'multipart/form-data' },
        onUploadProgress: (e) => {
          if (!e.total) return;
          setUploadProgress(Math.round((e.loaded / e.total) * 100));
        },
      });
      toast.success('Profile picture updated');
      setUser(prev => prev ? { ...prev, photoUrl: r.data.photoUrl } : prev);
      load();
      setCropSrc(null);
    } catch (err) {
      toast.error(err.response?.data?.message || 'Upload failed');
    } finally {
      setUploadingPhoto(false);
      setUploadProgress(0);
    }
  };

  const handlePhotoRemove = async () => {
    if (!window.confirm('Remove your profile picture?')) return;
    try {
      await api.delete('/profile/photo');
      toast.success('Profile picture removed');
      setUser(prev => prev ? { ...prev, photoUrl: null } : prev);
      load();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Remove failed');
    }
  };

  const load = () => {
    setLoading(true);
    api.get('/profile')
      .then((r) => {
        const d = r.data.data || {};
        setProfile(d);
        /* Every field a person may change about themselves, seeded from what
         * the server just returned. Matches backend/routes/profile.js's
         * SELF_EDITABLE list exactly — personal facts (contact details,
         * addresses, how they describe themselves) are theirs; anything with
         * a statutory or payroll consequence (name, DOB, PAN, bank details,
         * role, department, designation) is HR's and stays off this list. */
        setForm({
          nickName: d.nickName || '',
          phone: d.phone || '',
          personalEmail: d.personalEmail || '',
          gender: d.gender || '',
          maritalStatus: d.maritalStatus || '',
          bloodGroup: d.bloodGroup || '',
          nationality: d.nationality || '',
          aboutMe: d.aboutMe || '',
          address: d.address || '',
          addressLine1: d.addressLine1 || '',
          addressLine2: d.addressLine2 || '',
          addressCity: d.addressCity || '',
          addressState: d.addressState || '',
          addressPincode: d.addressPincode || '',
          addressCountry: d.addressCountry || '',
          permanentAddress: d.permanentAddress || '',
          permanentAddressLine1: d.permanentAddressLine1 || '',
          permanentAddressLine2: d.permanentAddressLine2 || '',
          permanentAddressCity: d.permanentAddressCity || '',
          permanentAddressState: d.permanentAddressState || '',
          permanentAddressPincode: d.permanentAddressPincode || '',
          permanentAddressCountry: d.permanentAddressCountry || '',
          emergencyContactName: d.emergencyContactName || '',
          emergencyContactPhone: d.emergencyContactPhone || '',
          emergencyContactRelation: d.emergencyContactRelation || '',
          emergencyContactDob: d.emergencyContactDob ? String(d.emergencyContactDob).slice(0, 10) : '',
        });
      })
      .catch((err) => {
        console.error(err);
        toast.error(err.response?.data?.message || 'Failed to load profile');
      })
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  const handleSave = async (e) => {
    e?.preventDefault?.();
    setSaving(true);
    try {
      await api.put('/profile', form);
      toast.success('Profile updated');
      setEditing(false);
      load();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to update');
    } finally {
      setSaving(false);
    }
  };

  const handlePwChange = async (e) => {
    e.preventDefault();
    if (pwForm.newPassword !== pwForm.confirmPassword) return toast.error('Passwords do not match');
    if (pwForm.newPassword.length < 6) return toast.error('Password must be at least 6 characters');
    setSaving(true);
    try {
      await api.put('/profile/change-password', pwForm);
      toast.success('Password updated');
      setPwModal(false);
      setPwForm({ currentPassword: '', newPassword: '', confirmPassword: '' });
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center py-20">
        <div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }
  if (!profile) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-20 text-center">
        <p className="text-[15px] text-slate-500">Couldn't load your profile.</p>
        <button
          type="button"
          onClick={load}
          className="text-[14px] font-semibold text-brand-600 hover:text-brand-500"
        >
          Retry
        </button>
      </div>
    );
  }

  const initials = `${profile.firstName?.[0] || ''}${profile.lastName?.[0] || ''}`.toUpperCase();
  const fullName = `${profile.firstName || ''} ${profile.lastName || ''}`.trim();
  const managerName = profile.manager
    ? `${profile.manager.firstName} ${profile.manager.lastName}${profile.manager.employeeId ? ' ' + profile.manager.employeeId : ''}`
    : null;
  const approverName = profile.approvingAuthority
    ? `${profile.approvingAuthority.firstName} ${profile.approvingAuthority.lastName}${profile.approvingAuthority.employeeId ? ' ' + profile.approvingAuthority.employeeId : ''}`
    : null;

  return (
    <div className="bg-[#f5f6f8] min-h-screen">
      {/* ── Header bar (matches Zoho's compact top strip) ───────────────────── */}
      <div className="bg-white border-b border-slate-200 sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-6 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={triggerPhotoPicker}
              title="Change profile picture"
              className="relative group w-9 h-9 rounded-full overflow-hidden focus:outline-none focus:ring-2 focus:ring-blue-300"
            >
              {profile.photoUrl ? (
                <img src={profile.photoUrl} alt="" className="w-9 h-9 rounded-full object-cover" />
              ) : (
                <div className="w-9 h-9 rounded-full bg-slate-200 text-slate-600 flex items-center justify-center text-[14px] font-bold">
                  {initials}
                </div>
              )}
              <div className="absolute inset-0 bg-black/50 text-white items-center justify-center hidden group-hover:flex">
                <Camera size={13} />
              </div>
            </button>
            <h1 className="text-[17px] font-semibold text-slate-800">
              {profile.employeeId} <span className="text-slate-400 font-normal">-</span> {fullName}
            </h1>
          </div>
          <div className="flex items-center gap-2">
            {editing ? (
              <>
                <button
                  onClick={cancelEdit}
                  disabled={saving}
                  className="text-[13.5px] font-semibold text-slate-500 hover:text-slate-800 px-3 py-1.5 rounded-lg hover:bg-slate-100 transition-colors disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSave}
                  disabled={saving}
                  className="flex items-center gap-1.5 text-[13.5px] font-semibold text-white bg-brand-600 hover:bg-brand-500 px-3.5 py-1.5 rounded-lg transition-colors disabled:opacity-60"
                >
                  <Check size={14} /> {saving ? 'Saving...' : 'Save'}
                </button>
              </>
            ) : (
              <>
                <button
                  onClick={openEdit}
                  className="w-8 h-8 rounded hover:bg-slate-100 text-slate-500 hover:text-slate-800 flex items-center justify-center transition-colors"
                  title="Edit profile"
                >
                  <Pencil size={15} />
                </button>
                <button
                  onClick={() => navigate('/')}
                  className="w-8 h-8 rounded hover:bg-slate-100 text-slate-500 hover:text-slate-800 flex items-center justify-center transition-colors"
                  title="Close"
                >
                  <X size={16} />
                </button>
              </>
            )}
          </div>
        </div>
        {editing && (
          <div className="bg-blue-50 border-t border-blue-100 px-6 py-2">
            <p className="max-w-6xl mx-auto text-[13px] text-blue-800">
              Your contact details, addresses and how you describe yourself are yours to update.
              Work details, identity numbers and bank information are managed by HR — contact
              admin to change those.
            </p>
          </div>
        )}
      </div>

      {/* Hidden file input — opened by the header avatar or the section button */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/png,image/jpeg,image/jpg,image/webp,image/gif"
        onChange={handlePhotoChange}
        className="hidden"
      />

      {/* ── Profile photo lightbox — Instagram/WhatsApp-style viewer.
       *  Tap the photo, see it big; tap anywhere or press Escape to close. ── */}
      {viewerOpen && profile.photoUrl && (
        <div
          className="fixed inset-0 z-[60] bg-black/85 flex items-center justify-center p-4 cursor-zoom-out"
          onClick={() => setViewerOpen(false)}
          role="dialog"
          aria-modal="true"
        >
          <button
            type="button"
            onClick={() => setViewerOpen(false)}
            className="absolute top-4 right-4 w-10 h-10 rounded-full bg-white/10 hover:bg-white/20 text-white flex items-center justify-center"
            aria-label="Close"
          >
            <X size={20} />
          </button>
          <img
            src={profile.photoUrl}
            alt={fullName}
            onClick={e => e.stopPropagation()}
            className="max-w-[92vw] max-h-[88vh] rounded-2xl shadow-2xl object-contain cursor-default"
          />
        </div>
      )}

      {/* Shared cropper modal — also used by Dashboard's avatar lightbox */}
      <PhotoCropperModal
        src={cropSrc}
        uploading={uploadingPhoto}
        onSave={handleCropSave}
        onCancel={() => setCropSrc(null)}
      />

      {/* ── Sections ───────────────────────────────────────────────────────── */}
      <div className="max-w-6xl mx-auto px-6 py-6 space-y-4">

        {/* Profile Picture — available to every role (employee / manager / admin) */}
        <section className="bg-white border border-slate-200 rounded-md">
          <h3 className="px-6 py-4 text-[17px] font-bold text-slate-800 border-b border-slate-100">
            Profile Picture
          </h3>
          <div className="px-6 py-5 flex items-center gap-5">
            <div className="relative shrink-0">
              {profile.photoUrl ? (
                <button
                  type="button"
                  onClick={() => setViewerOpen(true)}
                  title="View full size"
                  className="block rounded-full focus:outline-none focus:ring-2 focus:ring-blue-300"
                >
                  <img
                    src={profile.photoUrl}
                    alt="Profile"
                    className="w-20 h-20 rounded-full object-cover border border-slate-200 cursor-zoom-in hover:opacity-90 transition-opacity"
                  />
                </button>
              ) : (
                <div className="w-20 h-20 rounded-full bg-slate-100 text-slate-500 flex items-center justify-center text-[22px] font-bold border border-slate-200">
                  {initials}
                </div>
              )}
              {uploadingPhoto && (
                <div className="absolute inset-0 rounded-full bg-white/70 flex flex-col items-center justify-center">
                  <div className="w-5 h-5 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
                  {uploadProgress > 0 && (
                    <span className="text-[12px] font-semibold text-blue-600 mt-1">{uploadProgress}%</span>
                  )}
                </div>
              )}
            </div>
            <div className="flex-1">
              <p className="text-[15px] text-slate-600 mb-1">
                Add a photo so your colleagues can recognise you across the app.
              </p>
              <p className="text-[13px] text-slate-400 mb-3">JPG, PNG, WebP or GIF — up to 10 MB.</p>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={triggerPhotoPicker}
                  disabled={uploadingPhoto}
                  className="inline-flex items-center gap-1.5 text-[14px] font-semibold text-white bg-brand-600 hover:bg-brand-500 px-3 py-1.5 rounded-md transition-colors disabled:opacity-60"
                >
                  <Camera size={13} /> {profile.photoUrl ? 'Change photo' : 'Upload photo'}
                </button>
                {profile.photoUrl && (
                  <button
                    type="button"
                    onClick={handlePhotoRemove}
                    disabled={uploadingPhoto}
                    className="inline-flex items-center gap-1.5 text-[14px] font-semibold text-slate-600 hover:text-red-600 border border-slate-200 hover:border-red-200 hover:bg-red-50/60 px-3 py-1.5 rounded-md transition-colors disabled:opacity-60"
                  >
                    <Trash2 size={13} /> Remove
                  </button>
                )}
              </div>
            </div>
          </div>
        </section>

        <Section title="Basic Information">
          <Row label="Employee ID">{profile.employeeId}</Row>
          <Row label="Email Address">{profile.email}</Row>
          <Row label="First Name">{profile.firstName}</Row>
          <EditableRow label="Phone" editing={editing} value={form.phone}
            onChange={v => set('phone', v)} placeholder="+91 98765 43210" display={profile.phone} />
          <Row label="Last Name">{profile.lastName}</Row>
          <EditableRow label="Nickname" editing={editing} value={form.nickName}
            onChange={v => set('nickName', v)} placeholder="What people call you"
            display={profile.nickName} />
          <Row label="Status">
            {profile.status ? (
              <span className={`inline-block px-2 py-0.5 rounded text-[13px] font-semibold ${
                profile.status === 'active'
                  ? 'bg-emerald-50 text-emerald-700'
                  : 'bg-slate-100 text-slate-600'
              }`}>
                {profile.status}
              </span>
            ) : null}
          </Row>
        </Section>

        <Section title="Work Information">
          <Row label="Department">{profile.department}</Row>
          <Row label="Designation">{profile.designation}</Row>
          <Row label="Company">{profile.company}</Row>
          <Row label="Division">{profile.division}</Row>
          <Row label="Work Location">{profile.workLocation}</Row>
          <Row label="Employment Type">{profile.employmentType}</Row>
          <Row label="Source of Hire">{profile.sourceOfHire}</Row>
          <Row label="Role">{profile.role ? roleLabel(profile.role) : null}</Row>
          <Row label="Date of Joining">{fmtDate(profile.joiningDate)}</Row>
          <Row label="Total Experience">{profile.totalExperience}</Row>
          <Row label="Expertise">{profile.expertise}</Row>
          <Row label="Shift">
            {profile.shift?.name
              ? `${profile.shift.name} (${profile.shift.startTime}–${profile.shift.endTime})`
              : null}
          </Row>
          <Row label="Exit Date">{profile.exitDate ? fmtDate(profile.exitDate) : null}</Row>
        </Section>

        <Section title="Hierarchy Information">
          <Row label="Reporting Person">{managerName}</Row>
          <Row label="Secondary Reporting Person">{approverName}</Row>
        </Section>

        <Section title="Contact Information">
          <EditableRow label="Personal Email" editing={editing} value={form.personalEmail}
            onChange={v => set('personalEmail', v)} placeholder="you@example.com"
            display={profile.personalEmail} />
          <Row label="Work Phone">{profile.workPhone}</Row>
          <Row label="Extension">{profile.extension}</Row>
        </Section>

        <Section title="Personal Details">
          <Row label="Date of Birth">{profile.dateOfBirth ? fmtDate(profile.dateOfBirth) : null}</Row>
          <EditableRow label="Gender" editing={editing} type="select" value={form.gender}
            onChange={v => set('gender', v)} options={['Male', 'Female', 'Other']}
            display={profile.gender} />
          <EditableRow label="Marital Status" editing={editing} type="select" value={form.maritalStatus}
            onChange={v => set('maritalStatus', v)}
            options={['Single', 'Married', 'Divorced', 'Widowed']} display={profile.maritalStatus} />
          <EditableRow label="Blood Group" editing={editing} type="select" value={form.bloodGroup}
            onChange={v => set('bloodGroup', v)}
            options={['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-']} display={profile.bloodGroup} />
          <EditableRow label="Nationality" editing={editing} value={form.nationality}
            onChange={v => set('nationality', v)} placeholder="Indian" display={profile.nationality} />
          <EditableRow label="About Me" editing={editing} type="textarea" value={form.aboutMe}
            onChange={v => set('aboutMe', v)} placeholder="A line or two about yourself"
            display={profile.aboutMe} />
        </Section>

        <Section title="Current Address">
          <EditableRow label="Address" editing={editing} type="textarea" value={form.address}
            onChange={v => set('address', v)} placeholder="Where you currently live"
            display={profile.address} />
          <EditableRow label="Address Line 1" editing={editing} value={form.addressLine1}
            onChange={v => set('addressLine1', v)} display={profile.addressLine1} />
          <EditableRow label="Address Line 2" editing={editing} value={form.addressLine2}
            onChange={v => set('addressLine2', v)} display={profile.addressLine2} />
          <EditableRow label="City" editing={editing} value={form.addressCity}
            onChange={v => set('addressCity', v)} display={profile.addressCity} />
          <EditableRow label="State" editing={editing} value={form.addressState}
            onChange={v => set('addressState', v)} display={profile.addressState} />
          <EditableRow label="Pincode" editing={editing} value={form.addressPincode}
            onChange={v => set('addressPincode', v)} display={profile.addressPincode} />
          <EditableRow label="Country" editing={editing} value={form.addressCountry}
            onChange={v => set('addressCountry', v)} display={profile.addressCountry} />
        </Section>

        <Section title="Permanent Address">
          <EditableRow label="Address" editing={editing} type="textarea" value={form.permanentAddress}
            onChange={v => set('permanentAddress', v)} display={profile.permanentAddress} />
          <EditableRow label="Address Line 1" editing={editing} value={form.permanentAddressLine1}
            onChange={v => set('permanentAddressLine1', v)} display={profile.permanentAddressLine1} />
          <EditableRow label="Address Line 2" editing={editing} value={form.permanentAddressLine2}
            onChange={v => set('permanentAddressLine2', v)} display={profile.permanentAddressLine2} />
          <EditableRow label="City" editing={editing} value={form.permanentAddressCity}
            onChange={v => set('permanentAddressCity', v)} display={profile.permanentAddressCity} />
          <EditableRow label="State" editing={editing} value={form.permanentAddressState}
            onChange={v => set('permanentAddressState', v)} display={profile.permanentAddressState} />
          <EditableRow label="Pincode" editing={editing} value={form.permanentAddressPincode}
            onChange={v => set('permanentAddressPincode', v)} display={profile.permanentAddressPincode} />
          <EditableRow label="Country" editing={editing} value={form.permanentAddressCountry}
            onChange={v => set('permanentAddressCountry', v)} display={profile.permanentAddressCountry} />
        </Section>

        <Section title="Identity Information">
          <Row label="PAN">{profile.panNumber ? <Masked value={profile.panNumber} /> : null}</Row>
          <Row label="Aadhaar Number">{profile.aadhaarNumber ? <Masked value={profile.aadhaarNumber} /> : null}</Row>
          <Row label="UAN Number">{profile.uanNumber ? <Masked value={profile.uanNumber} /> : null}</Row>
          <Row label="Bank Name">{profile.bankName}</Row>
          <Row label="Bank Account">{profile.bankAccount ? <Masked value={profile.bankAccount} /> : null}</Row>
          <Row label="Bank IFSC">{profile.bankIfsc}</Row>
        </Section>

        <Section title="Emergency Contact">
          <EditableRow label="Contact Name" editing={editing} value={form.emergencyContactName}
            onChange={v => set('emergencyContactName', v)} placeholder="Name"
            display={profile.emergencyContactName} />
          <EditableRow label="Contact Phone" editing={editing} value={form.emergencyContactPhone}
            onChange={v => set('emergencyContactPhone', v)} placeholder="+91 ..."
            display={profile.emergencyContactPhone} />
          <EditableRow label="Relationship" editing={editing} type="select"
            value={form.emergencyContactRelation} onChange={v => set('emergencyContactRelation', v)}
            options={['Spouse', 'Parent', 'Sibling', 'Child', 'Friend', 'Other']}
            display={profile.emergencyContactRelation} />
          <EditableRow label="Date of Birth" editing={editing} type="date" value={form.emergencyContactDob}
            onChange={v => set('emergencyContactDob', v)}
            display={profile.emergencyContactDob ? fmtDate(profile.emergencyContactDob) : null} />
        </Section>

        {/* Education — synced from Zoho's "Education Details" tabular section.
            One card per row so multiple degrees show cleanly. */}
        <section className="bg-white border border-slate-200 rounded-md">
          <h3 className="px-6 py-4 text-[17px] font-bold text-slate-800 border-b border-slate-100">
            Education
          </h3>
          {profile.education && profile.education.length > 0 ? (
            <div className="px-6 py-3 space-y-3">
              {profile.education.map((ed, i) => (
                <div key={ed.id || i} className="grid grid-cols-1 md:grid-cols-2 md:gap-x-12">
                  <Row label="Qualification">{ed.qualification}</Row>
                  <Row label="Degree">{ed.degree}</Row>
                  <Row label="Course / Specialization">{ed.course}</Row>
                  <Row label="Institute">{ed.institute}</Row>
                  <Row label="Year of Passing">{ed.yearOfPassing}</Row>
                  <Row label="Percentage / CGPA">{ed.percentageOrCgpa}</Row>
                </div>
              ))}
            </div>
          ) : (
            <p className="px-6 py-5 text-[15px] text-slate-400 italic">
              No education records yet. Add a row under <span className="font-medium">Education Details</span> in Zoho People.
            </p>
          )}
        </section>

        {/* Previous Employment — synced from Zoho's "Work experience" tabular section. */}
        <section className="bg-white border border-slate-200 rounded-md">
          <h3 className="px-6 py-4 text-[17px] font-bold text-slate-800 border-b border-slate-100">
            Previous Employment
          </h3>
          {profile.previousEmployment && profile.previousEmployment.length > 0 ? (
            <div className="px-6 py-3 space-y-3">
              {profile.previousEmployment.map((pe, i) => (
                <div key={pe.id || i} className="grid grid-cols-1 md:grid-cols-2 md:gap-x-12">
                  <Row label="Company">{pe.company}</Row>
                  <Row label="Designation">{pe.designation}</Row>
                  <Row label="From">{pe.fromDate ? fmtDate(pe.fromDate) : null}</Row>
                  <Row label="To">{pe.toDate ? fmtDate(pe.toDate) : null}</Row>
                  <Row label="Description">{pe.description}</Row>
                </div>
              ))}
            </div>
          ) : (
            <p className="px-6 py-5 text-[15px] text-slate-400 italic">
              No previous employment records yet. Add a row under <span className="font-medium">Work experience</span> in Zoho People.
            </p>
          )}
        </section>

        <Section title="Security">
          <Row label="Password">
            <div className="flex items-center gap-3">
              <span className="text-slate-500">Last changed: unknown</span>
              <button
                type="button"
                onClick={() => setPwModal(true)}
                className="inline-flex items-center gap-1.5 text-[14px] font-semibold text-brand-600 hover:text-brand-500"
              >
                <Key size={12} /> Change
              </button>
            </div>
          </Row>
          <Row label="Account Role">
            <span>{roleLabel(profile.role)}</span>
            <span className="text-slate-400 text-[14px] ml-2">(contact admin to change)</span>
          </Row>
        </Section>

        {/* Two-factor authentication — own card so the toggle is prominent */}
        <div className="px-1">
          <MfaSettingsCard mfaEnabled={!!profile.mfaEnabled} onChange={load} />
        </div>
      </div>


      {/* ── Change Password Modal (unchanged behaviour) ─────────────────────── */}
      {pwModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl w-full max-w-sm shadow-2xl">
            <div className="flex items-center justify-between p-6 border-b border-slate-100">
              <h3 className="font-semibold text-slate-800 text-xl">Change Password</h3>
              <button
                onClick={() => setPwModal(false)}
                className="w-8 h-8 flex items-center justify-center rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-600"
              >
                <X size={16} />
              </button>
            </div>
            <form onSubmit={handlePwChange} className="p-6 space-y-4">
              {[
                ['Current Password', 'currentPassword'],
                ['New Password', 'newPassword'],
                ['Confirm New Password', 'confirmPassword'],
              ].map(([label, key]) => (
                <div key={key}>
                  <label className="block text-sm font-medium text-slate-600 mb-1.5">{label}</label>
                  <input
                    type="password"
                    value={pwForm[key]}
                    onChange={(e) => setPwForm({ ...pwForm, [key]: e.target.value })}
                    required
                    className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-base focus:outline-none focus:border-blue-400"
                  />
                </div>
              ))}
              <div className="flex gap-3 pt-1">
                <button
                  type="button"
                  onClick={() => setPwModal(false)}
                  className="flex-1 border border-slate-200 text-slate-600 py-2.5 rounded-xl text-base font-medium hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="flex-1 bg-brand-600 hover:bg-brand-500 text-white py-2.5 rounded-xl text-base font-medium transition-colors disabled:opacity-60"
                >
                  {saving ? 'Updating...' : 'Update Password'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
