import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Pencil, X, Eye, EyeOff, Save, Key, Camera, Trash2 } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import Cropper from 'react-easy-crop';
import api from '../utils/api';
import toast from 'react-hot-toast';
import { useAuth } from '../context/AuthContext';
import MfaSettingsCard from '../components/MfaSettingsCard';

/* ── Helper: take a cropped region of an Image and return a JPEG Blob.
 *  react-easy-crop hands back pixel coordinates in `croppedAreaPixels`; we
 *  paint that rectangle onto an offscreen canvas and toBlob() it. */
function getCroppedBlob(imageSrc, croppedAreaPixels) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = croppedAreaPixels.width;
      canvas.height = croppedAreaPixels.height;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(
        img,
        croppedAreaPixels.x, croppedAreaPixels.y,
        croppedAreaPixels.width, croppedAreaPixels.height,
        0, 0,
        croppedAreaPixels.width, croppedAreaPixels.height
      );
      canvas.toBlob(b => (b ? resolve(b) : reject(new Error('Crop failed'))), 'image/jpeg', 0.92);
    };
    img.onerror = () => reject(new Error('Image load failed'));
    img.src = imageSrc;
  });
}

/* ── helpers ──────────────────────────────────────────────────────────────── */

const fmtDate = (iso) =>
  iso ? new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '-';

/** Single field row — label on the left, value on the right (Zoho style). */
const Row = ({ label, children }) => (
  <div className="grid grid-cols-[160px_1fr] gap-4 items-start py-3 border-b border-slate-100 last:border-b-0">
    <span className="text-[13px] text-slate-500">{label}</span>
    <span className="text-[13px] text-slate-800 font-medium break-words">
      {children == null || children === '' ? <span className="text-slate-300">-</span> : children}
    </span>
  </div>
);

/** Card section with title + a 2-column grid of rows. */
const Section = ({ title, children }) => (
  <section className="bg-white border border-slate-200 rounded-md">
    <h3 className="px-6 py-4 text-[15px] font-bold text-slate-800 border-b border-slate-100">
      {title}
    </h3>
    <div className="px-6 py-1 grid grid-cols-1 md:grid-cols-2 md:gap-x-12">
      {children}
    </div>
  </section>
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
  const [editModal, setEditModal] = useState(false);
  const [pwModal, setPwModal] = useState(false);
  const [form, setForm] = useState({});
  const [pwForm, setPwForm] = useState({ currentPassword: '', newPassword: '', confirmPassword: '' });
  const [saving, setSaving] = useState(false);

  const fileInputRef = useRef(null);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  // Cropper state — set when the user picks a file, cleared when they
  // confirm or cancel. While `cropSrc` is non-null the cropper modal is open.
  const [cropSrc, setCropSrc]                       = useState(null);
  const [cropPos, setCropPos]                       = useState({ x: 0, y: 0 });
  const [cropZoom, setCropZoom]                     = useState(1);
  const [croppedAreaPixels, setCroppedAreaPixels]   = useState(null);
  const onCropComplete = useCallback((_area, areaPixels) => {
    setCroppedAreaPixels(areaPixels);
  }, []);
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
    reader.onload = () => {
      setCropSrc(reader.result);
      setCropPos({ x: 0, y: 0 });
      setCropZoom(1);
    };
    reader.readAsDataURL(file);
    // Reset the file input so picking the same file again re-opens the cropper.
    e.target.value = '';
  };

  // Step 2 — user clicks Save in the cropper modal. Render the cropped
  // region to a JPEG blob, upload that, refresh the profile.
  const handleCropSave = async () => {
    if (!cropSrc || !croppedAreaPixels) return;
    setUploadingPhoto(true);
    try {
      const blob = await getCroppedBlob(cropSrc, croppedAreaPixels);
      const form = new FormData();
      form.append('photo', blob, 'profile.jpg');
      const r = await api.post('/profile/photo', form, { headers: { 'Content-Type': 'multipart/form-data' } });
      toast.success('Profile picture updated');
      // Propagate the new URL to AuthContext so every avatar (sidebar, topbar,
      // dashboard) updates without waiting for a re-login.
      setUser(prev => prev ? { ...prev, photoUrl: r.data.photoUrl } : prev);
      load();
      setCropSrc(null);
    } catch (err) {
      toast.error(err.response?.data?.message || 'Upload failed');
    } finally {
      setUploadingPhoto(false);
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
        // Only the fields employees are allowed to self-edit.
        // Name, DOB, PAN, bank details, role, dept — HR-managed.
        setForm({
          phone: d.phone || '',
          address: d.address || '',
          emergencyContactName: d.emergencyContactName || '',
          emergencyContactPhone: d.emergencyContactPhone || '',
          emergencyContactRelation: d.emergencyContactRelation || '',
        });
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  const handleSave = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      await api.put('/profile', form);
      toast.success('Profile updated');
      setEditModal(false);
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
  if (!profile) return null;

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
                <div className="w-9 h-9 rounded-full bg-slate-200 text-slate-600 flex items-center justify-center text-[12px] font-bold">
                  {initials}
                </div>
              )}
              <div className="absolute inset-0 bg-black/50 text-white items-center justify-center hidden group-hover:flex">
                <Camera size={13} />
              </div>
            </button>
            <h1 className="text-[15px] font-semibold text-slate-800">
              {profile.employeeId} <span className="text-slate-400 font-normal">-</span> {fullName}
            </h1>
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setEditModal(true)}
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
          </div>
        </div>
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

      {/* ── Cropper modal — opens after the user picks a file. Drag to
       *  reposition, scroll/slider to zoom, the circle marks what will
       *  be saved as the profile photo. ── */}
      {cropSrc && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md flex flex-col">
            <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
              <div>
                <h3 className="text-[15px] font-semibold text-slate-800">Position your photo</h3>
                <p className="text-[11.5px] text-slate-500 mt-0.5">Drag to move · scroll or use the slider to zoom</p>
              </div>
              <button
                onClick={() => setCropSrc(null)}
                disabled={uploadingPhoto}
                className="w-8 h-8 flex items-center justify-center rounded hover:bg-slate-100 text-slate-500 disabled:opacity-50"
              >
                <X size={16} />
              </button>
            </div>

            <div className="relative h-[320px] bg-slate-900">
              <Cropper
                image={cropSrc}
                crop={cropPos}
                zoom={cropZoom}
                aspect={1}
                cropShape="round"
                showGrid={false}
                onCropChange={setCropPos}
                onZoomChange={setCropZoom}
                onCropComplete={onCropComplete}
              />
            </div>

            <div className="px-5 py-3 border-t border-slate-100">
              <label className="text-[11px] font-medium text-slate-500 block mb-1">Zoom</label>
              <input
                type="range"
                min={1}
                max={3}
                step={0.05}
                value={cropZoom}
                onChange={e => setCropZoom(Number(e.target.value))}
                className="w-full accent-blue-600"
              />
            </div>

            <div className="px-5 py-3 border-t border-slate-100 flex justify-end gap-2">
              <button
                onClick={() => setCropSrc(null)}
                disabled={uploadingPhoto}
                className="border border-slate-200 text-slate-600 px-4 py-2 rounded-lg text-[13px] font-semibold hover:bg-slate-50 disabled:opacity-60"
              >
                Cancel
              </button>
              <button
                onClick={handleCropSave}
                disabled={uploadingPhoto || !croppedAreaPixels}
                className="bg-[#1a73e8] hover:bg-[#1557B0] text-white px-4 py-2 rounded-lg text-[13px] font-semibold disabled:opacity-60 flex items-center gap-1.5"
              >
                <Save size={13} /> {uploadingPhoto ? 'Saving…' : 'Save photo'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Sections ───────────────────────────────────────────────────────── */}
      <div className="max-w-6xl mx-auto px-6 py-6 space-y-4">

        {/* Profile Picture — available to every role (employee / manager / admin) */}
        <section className="bg-white border border-slate-200 rounded-md">
          <h3 className="px-6 py-4 text-[15px] font-bold text-slate-800 border-b border-slate-100">
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
                <div className="absolute inset-0 rounded-full bg-white/70 flex items-center justify-center">
                  <div className="w-5 h-5 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
                </div>
              )}
            </div>
            <div className="flex-1">
              <p className="text-[13px] text-slate-600 mb-1">
                Add a photo so your colleagues can recognise you across the app.
              </p>
              <p className="text-[11.5px] text-slate-400 mb-3">JPG, PNG, WebP or GIF — up to 5 MB.</p>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={triggerPhotoPicker}
                  disabled={uploadingPhoto}
                  className="inline-flex items-center gap-1.5 text-[12.5px] font-semibold text-white bg-[#1a73e8] hover:bg-[#1557B0] px-3 py-1.5 rounded-md transition-colors disabled:opacity-60"
                >
                  <Camera size={13} /> {profile.photoUrl ? 'Change photo' : 'Upload photo'}
                </button>
                {profile.photoUrl && (
                  <button
                    type="button"
                    onClick={handlePhotoRemove}
                    disabled={uploadingPhoto}
                    className="inline-flex items-center gap-1.5 text-[12.5px] font-semibold text-slate-600 hover:text-red-600 border border-slate-200 hover:border-red-200 hover:bg-red-50/60 px-3 py-1.5 rounded-md transition-colors disabled:opacity-60"
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
          <Row label="Phone">{profile.phone}</Row>
          <Row label="Last Name">{profile.lastName}</Row>
          <Row label="Nickname">{profile.nickName}</Row>
          <Row label="Status">
            {profile.status ? (
              <span className={`inline-block px-2 py-0.5 rounded text-[11.5px] font-semibold ${
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
          <Row label="Role">{profile.role}</Row>
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
          <Row label="Reporting Manager">{managerName}</Row>
          <Row label="Approving Authority">{approverName}</Row>
        </Section>

        <Section title="Contact Information">
          <Row label="Personal Email">{profile.personalEmail}</Row>
          <Row label="Work Phone">{profile.workPhone}</Row>
          <Row label="Extension">{profile.extension}</Row>
        </Section>

        <Section title="Personal Details">
          <Row label="Date of Birth">{profile.dateOfBirth ? fmtDate(profile.dateOfBirth) : null}</Row>
          <Row label="Gender">{profile.gender}</Row>
          <Row label="Marital Status">{profile.maritalStatus}</Row>
          <Row label="Blood Group">{profile.bloodGroup}</Row>
          <Row label="Nationality">{profile.nationality}</Row>
          <Row label="About Me">{profile.aboutMe}</Row>
        </Section>

        <Section title="Current Address">
          <Row label="Address">{profile.address}</Row>
          <Row label="Address Line 1">{profile.addressLine1}</Row>
          <Row label="Address Line 2">{profile.addressLine2}</Row>
          <Row label="City">{profile.addressCity}</Row>
          <Row label="State">{profile.addressState}</Row>
          <Row label="Pincode">{profile.addressPincode}</Row>
          <Row label="Country">{profile.addressCountry}</Row>
        </Section>

        <Section title="Permanent Address">
          <Row label="Address">{profile.permanentAddress}</Row>
          <Row label="Address Line 1">{profile.permanentAddressLine1}</Row>
          <Row label="Address Line 2">{profile.permanentAddressLine2}</Row>
          <Row label="City">{profile.permanentAddressCity}</Row>
          <Row label="State">{profile.permanentAddressState}</Row>
          <Row label="Pincode">{profile.permanentAddressPincode}</Row>
          <Row label="Country">{profile.permanentAddressCountry}</Row>
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
          <Row label="Contact Name">{profile.emergencyContactName}</Row>
          <Row label="Contact Phone">{profile.emergencyContactPhone}</Row>
          <Row label="Relationship">{profile.emergencyContactRelation}</Row>
          <Row label="Date of Birth">{profile.emergencyContactDob ? fmtDate(profile.emergencyContactDob) : null}</Row>
        </Section>

        {/* Education — synced from Zoho's "Education Details" tabular section.
            One card per row so multiple degrees show cleanly. */}
        <section className="bg-white border border-slate-200 rounded-md">
          <h3 className="px-6 py-4 text-[15px] font-bold text-slate-800 border-b border-slate-100">
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
            <p className="px-6 py-5 text-[13px] text-slate-400 italic">
              No education records yet. Add a row under <span className="font-medium">Education Details</span> in Zoho People.
            </p>
          )}
        </section>

        {/* Previous Employment — synced from Zoho's "Work experience" tabular section. */}
        <section className="bg-white border border-slate-200 rounded-md">
          <h3 className="px-6 py-4 text-[15px] font-bold text-slate-800 border-b border-slate-100">
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
            <p className="px-6 py-5 text-[13px] text-slate-400 italic">
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
                className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-[#1a73e8] hover:text-[#1557B0]"
              >
                <Key size={12} /> Change
              </button>
            </div>
          </Row>
          <Row label="Account Role">
            <span className="capitalize">{profile.role}</span>
            <span className="text-slate-400 text-[12px] ml-2">(contact admin to change)</span>
          </Row>
        </Section>

        {/* Two-factor authentication — own card so the toggle is prominent */}
        <div className="px-1">
          <MfaSettingsCard mfaEnabled={!!profile.mfaEnabled} onChange={load} />
        </div>
      </div>

      {/* ── Edit Profile Modal — only fields the employee is allowed to self-edit ── */}
      {editModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl w-full max-w-2xl shadow-2xl max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between p-6 border-b border-slate-100 flex-shrink-0">
              <div>
                <h3 className="font-semibold text-slate-800 text-lg">Edit Profile</h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Work info, role, and email are managed by HR — contact admin to change those.
                </p>
              </div>
              <button
                onClick={() => setEditModal(false)}
                className="w-8 h-8 flex items-center justify-center rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-600"
              >
                <X size={16} />
              </button>
            </div>
            <form onSubmit={handleSave} className="p-6 space-y-5 overflow-y-auto flex-1">

              {/* Alternative Phone */}
              <div>
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">Alternative Phone Number</p>
                <input
                  value={form.phone}
                  onChange={(e) => setForm({ ...form, phone: e.target.value })}
                  className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-blue-400"
                  placeholder="+91 98765 43210"
                />
                <p className="text-[11px] text-slate-400 mt-1.5">A reachable personal number — work phone is set by HR.</p>
              </div>

              {/* Current Address */}
              <div className="border-t border-slate-100 pt-4">
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">Current Address</p>
                <textarea
                  value={form.address}
                  onChange={(e) => setForm({ ...form, address: e.target.value })}
                  rows={2}
                  placeholder="Where you currently live..."
                  className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-blue-400 resize-none"
                />
              </div>

              {/* Emergency Contact */}
              <div className="border-t border-slate-100 pt-4">
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">Emergency Contact</p>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1.5">Contact Name</label>
                    <input
                      value={form.emergencyContactName}
                      onChange={(e) => setForm({ ...form, emergencyContactName: e.target.value })}
                      className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-blue-400"
                      placeholder="Name"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1.5">Phone</label>
                    <input
                      value={form.emergencyContactPhone}
                      onChange={(e) => setForm({ ...form, emergencyContactPhone: e.target.value })}
                      className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-blue-400"
                      placeholder="+91 ..."
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1.5">Relationship</label>
                    <select
                      value={form.emergencyContactRelation}
                      onChange={(e) => setForm({ ...form, emergencyContactRelation: e.target.value })}
                      className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-blue-400"
                    >
                      <option value="">Select...</option>
                      {['Spouse', 'Parent', 'Sibling', 'Child', 'Friend', 'Other'].map((r) => (
                        <option key={r}>{r}</option>
                      ))}
                    </select>
                  </div>
                </div>
              </div>

              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setEditModal(false)}
                  className="flex-1 border border-slate-200 text-slate-600 py-2.5 rounded-xl text-sm font-medium hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="flex-1 bg-[#1a73e8] hover:bg-[#1557B0] text-white py-2.5 rounded-xl text-sm font-medium transition-colors disabled:opacity-60 flex items-center justify-center gap-2"
                >
                  <Save size={14} />
                  {saving ? 'Saving...' : 'Save Changes'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── Change Password Modal (unchanged behaviour) ─────────────────────── */}
      {pwModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl w-full max-w-sm shadow-2xl">
            <div className="flex items-center justify-between p-6 border-b border-slate-100">
              <h3 className="font-semibold text-slate-800 text-lg">Change Password</h3>
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
                  <label className="block text-xs font-medium text-slate-600 mb-1.5">{label}</label>
                  <input
                    type="password"
                    value={pwForm[key]}
                    onChange={(e) => setPwForm({ ...pwForm, [key]: e.target.value })}
                    required
                    className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-blue-400"
                  />
                </div>
              ))}
              <div className="flex gap-3 pt-1">
                <button
                  type="button"
                  onClick={() => setPwModal(false)}
                  className="flex-1 border border-slate-200 text-slate-600 py-2.5 rounded-xl text-sm font-medium hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="flex-1 bg-[#1a73e8] hover:bg-[#1557B0] text-white py-2.5 rounded-xl text-sm font-medium transition-colors disabled:opacity-60"
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
