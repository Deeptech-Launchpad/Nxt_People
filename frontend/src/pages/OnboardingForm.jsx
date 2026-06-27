import React, { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import api from '../utils/api';
import toast from 'react-hot-toast';
import { Building2, CheckCircle2, ChevronRight, ChevronLeft, Upload, Plus, Trash2 } from 'lucide-react';

const STEPS = [
  'Personal Information',
  'Address Details',
  'Identity & Legal',
  'Emergency Contact',
  'Education Details',
  'Documents Upload'
];

const Input = ({ label, name, type = 'text', required = false, placeholder = '', value, onChange }) => (
  <div>
    <label className="block text-sm font-medium text-slate-700 mb-1.5">{label} {required && <span className="text-red-500">*</span>}</label>
    <input type={type} name={name} value={value || ''} onChange={onChange} placeholder={placeholder} className="w-full bg-white border border-slate-300 text-slate-900 px-4 py-2.5 rounded-xl text-sm focus:outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500" />
  </div>
);

const Select = ({ label, name, options, required = false, value, onChange }) => (
  <div>
    <label className="block text-sm font-medium text-slate-700 mb-1.5">{label} {required && <span className="text-red-500">*</span>}</label>
    <select name={name} value={value || ''} onChange={onChange} className="w-full bg-white border border-slate-300 text-slate-900 px-4 py-2.5 rounded-xl text-sm focus:outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500">
      <option value="">Select...</option>
      {options.map(o => <option key={o} value={o}>{o}</option>)}
    </select>
  </div>
);

const FileInput = ({ label, name, required = false, accept = ".pdf,.jpg,.jpeg,.png", file, onChange }) => (
  <div>
    <label className="block text-sm font-medium text-slate-700 mb-1.5">{label} {required && <span className="text-red-500">*</span>}</label>
    <div className="relative border-2 border-dashed border-slate-300 rounded-xl p-4 text-center hover:bg-slate-50 transition-colors">
      <input type="file" onChange={(e) => onChange(e, name)} accept={accept} className="absolute inset-0 w-full h-full opacity-0 cursor-pointer" />
      {file ? (
        <div className="flex flex-col items-center gap-1 text-emerald-600"><CheckCircle2 size={24}/> <span className="text-sm font-medium truncate w-full px-4">{file.name}</span></div>
      ) : (
        <div className="flex flex-col items-center gap-1 text-slate-500"><Upload size={24} className="text-slate-400"/> <span className="text-sm">Click to upload or drag & drop</span><span className="text-xs text-slate-400">Max 5MB</span></div>
      )}
    </div>
  </div>
);

export default function OnboardingForm() {
  const { token } = useParams();
  const [isValid, setIsValid] = useState(null);
  const [email, setEmail] = useState('');
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  // Form Data
  const [form, setForm] = useState({
    firstName: '', lastName: '', gender: '', dateOfBirth: '', maritalStatus: '', bloodGroup: '',
    mobile: '', alternateMobile: '',
    currentAddress: '', permanentAddress: '', city: '', state: '', country: '', pinCode: '',
    sameAsCurrent: false,
    aadhaarNumber: '', panNumber: '', passportNumber: '', drivingLicense: '', voterId: '', uanNumber: '',
    emergencyContactName: '', emergencyContactRelationship: '', emergencyContactNumber: '', emergencyContactAlternate: '',
  });

  const [education, setEducation] = useState([
    { highestQualification: '', degree: '', course: '', universityOrInstitution: '', yearOfPassing: '', percentageOrCgpa: '' }
  ]);

  const [files, setFiles] = useState({
    resume: null, aadhaarCard: null, panCard: null,
    tenthCertificate: null, twelfthCertificate: null, ugCertificate: null, pgCertificate: null,
    experienceLetters: null, passportPhoto: null
  });

  useEffect(() => {
    api.get(`/registrations/validate-token/${token}`)
      .then(r => { setIsValid(true); setEmail(r.data.email); })
      .catch(() => setIsValid(false))
      .finally(() => setLoading(false));
  }, [token]);

  const handleInputChange = (e) => {
    const { name, value, type, checked } = e.target;
    if (name === 'sameAsCurrent' && checked) {
      setForm(f => ({ ...f, sameAsCurrent: true, permanentAddress: f.currentAddress }));
    } else if (name === 'sameAsCurrent' && !checked) {
      setForm(f => ({ ...f, sameAsCurrent: false, permanentAddress: '' }));
    } else {
      setForm(f => ({ ...f, [name]: type === 'checkbox' ? checked : value }));
      if (form.sameAsCurrent && name === 'currentAddress') {
        setForm(f => ({ ...f, currentAddress: value, permanentAddress: value }));
      }
    }
  };

  const handleEduChange = (index, field, value) => {
    const newEdu = [...education];
    newEdu[index][field] = value;
    setEducation(newEdu);
  };

  const addEducation = () => setEducation([...education, { highestQualification: '', degree: '', course: '', universityOrInstitution: '', yearOfPassing: '', percentageOrCgpa: '' }]);
  const removeEducation = (index) => setEducation(education.filter((_, i) => i !== index));

  const handleFileChange = (e, field) => {
    if (e.target.files?.[0]) setFiles({ ...files, [field]: e.target.files[0] });
  };

  const validateStep = () => {
    if (step === 1) {
      if (!form.firstName || !form.lastName || !form.gender || !form.dateOfBirth || !form.maritalStatus || !form.mobile) {
        toast.error('Please fill all required fields in this step.');
        return false;
      }
      if (!/^[A-Za-z\s]+$/.test(form.firstName)) {
        toast.error('First name must contain only letters.');
        return false;
      }
      if (!/^[A-Za-z\s]+$/.test(form.lastName)) {
        toast.error('Last name must contain only letters.');
        return false;
      }
    }
    if (step === 2) {
      if (!form.currentAddress || !form.permanentAddress || !form.city || !form.state || !form.country || !form.pinCode) {
        toast.error('Please fill all required fields in this step.');
        return false;
      }
    }
    if (step === 3) {
      if (!form.aadhaarNumber || !form.panNumber) {
        toast.error('Aadhaar and PAN numbers are mandatory.');
        return false;
      }
      if (!/^\d{12}$/.test(form.aadhaarNumber)) {
        toast.error('Aadhaar number must be exactly 12 digits.');
        return false;
      }
      if (!/^[A-Z]{5}[0-9]{4}[A-Z]{1}$/i.test(form.panNumber)) {
        toast.error('Invalid PAN number format.');
        return false;
      }
    }
    if (step === 4) {
      if (!form.emergencyContactName || !form.emergencyContactRelationship || !form.emergencyContactNumber) {
        toast.error('Please fill all required fields in this step.');
        return false;
      }
    }
    if (step === 6) {
      if (!files.resume || !files.aadhaarCard || !files.panCard || !files.passportPhoto || !files.tenthCertificate || !files.twelfthCertificate || !files.ugCertificate) {
        toast.error('Please upload all required documents.');
        return false;
      }
    }
    return true;
  };

  const nextStep = () => { if (validateStep()) setStep(s => s + 1); };
  const prevStep = () => setStep(s => s - 1);

  const handleSubmit = async () => {
    if (!validateStep()) return;
    setSubmitting(true);
    try {
      const formData = new FormData();
      Object.keys(form).forEach(k => {
        if (k !== 'sameAsCurrent') formData.append(k, form[k]);
      });
      formData.append('personalEmail', email); // From token validation
      formData.append('education', JSON.stringify(education));
      Object.keys(files).forEach(k => {
        if (files[k]) formData.append(k, files[k]);
      });

      await api.post(`/registrations/submit/${token}`, formData, { headers: { 'Content-Type': 'multipart/form-data' } });
      setSubmitted(true);
    } catch (err) {
      toast.error(err.response?.data?.message || 'Submission failed.');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) return <div className="min-h-screen flex items-center justify-center bg-slate-50"><div className="w-8 h-8 border-4 border-brand-500 border-t-transparent rounded-full animate-spin"/></div>;

  if (!isValid) return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 p-6 text-center">
      <div className="bg-white p-8 rounded-2xl shadow-sm border border-slate-200 max-w-md w-full">
        <div className="w-16 h-16 bg-red-50 text-red-500 rounded-full flex items-center justify-center mx-auto mb-4"><CheckCircle2 size={32} className="rotate-45" /></div>
        <h2 className="text-xl font-bold text-slate-800 mb-2">Invalid Link</h2>
        <p className="text-slate-500">This onboarding link is invalid or has expired. Please contact HR.</p>
      </div>
    </div>
  );

  if (submitted) return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 p-6 text-center">
      <div className="bg-white p-10 rounded-2xl shadow-sm border border-slate-200 max-w-lg w-full">
        <div className="w-20 h-20 bg-emerald-50 text-emerald-500 rounded-full flex items-center justify-center mx-auto mb-5"><CheckCircle2 size={40} /></div>
        <h2 className="text-2xl font-display font-bold text-slate-800 mb-3">Submitted Successfully</h2>
        <p className="text-slate-600 text-lg">Your details have been submitted successfully. HR will review your information and get in touch with you.</p>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-slate-50 py-10 px-4">
      <div className="max-w-4xl mx-auto">
        <div className="flex items-center gap-3 mb-8 justify-center">
          <div className="w-10 h-10 bg-brand-600 rounded-xl flex items-center justify-center text-white shadow-lg shadow-brand-500/30">
            <Building2 size={24} />
          </div>
          <h1 className="text-2xl font-display font-bold text-slate-800 tracking-tight">Onboarding Portal</h1>
        </div>

        {/* Progress Bar */}
        <div className="mb-8">
          <div className="flex items-center justify-between relative">
            <div className="absolute left-0 top-1/2 -translate-y-1/2 w-full h-1 bg-slate-200 rounded-full z-0"></div>
            <div className="absolute left-0 top-1/2 -translate-y-1/2 h-1 bg-brand-500 rounded-full z-0 transition-all duration-500" style={{ width: `${((step - 1) / (STEPS.length - 1)) * 100}%` }}></div>
            {STEPS.map((s, i) => (
              <div key={i} className={`relative z-10 flex flex-col items-center gap-2 ${i + 1 <= step ? 'text-brand-600' : 'text-slate-400'}`}>
                <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold transition-all duration-300 border-2 ${i + 1 < step ? 'bg-brand-500 border-brand-500 text-white' : i + 1 === step ? 'bg-white border-brand-500 text-brand-600' : 'bg-white border-slate-300 text-slate-400'}`}>
                  {i + 1 < step ? <CheckCircle2 size={16} /> : i + 1}
                </div>
                <span className="text-xs font-medium hidden sm:block whitespace-nowrap absolute -bottom-6">{s}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden mt-12 sm:mt-8">
          <div className="p-6 sm:p-8">
            <h2 className="text-xl font-display font-bold text-slate-800 mb-6">{STEPS[step - 1]}</h2>

            {/* STEP 1 */}
            {step === 1 && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                <Input label="First Name" name="firstName" required value={form.firstName} onChange={handleInputChange} />
                <Input label="Last Name" name="lastName" required value={form.lastName} onChange={handleInputChange} />
                <Select label="Gender" name="gender" required options={['Male', 'Female', 'Other']} value={form.gender} onChange={handleInputChange} />
                <Input label="Date of Birth" name="dateOfBirth" type="date" required value={form.dateOfBirth} onChange={handleInputChange} />
                <Select label="Marital Status" name="maritalStatus" required options={['Single', 'Married', 'Divorced', 'Widowed']} value={form.maritalStatus} onChange={handleInputChange} />
                <Select label="Blood Group" name="bloodGroup" options={['A+', 'A-', 'B+', 'B-', 'O+', 'O-', 'AB+', 'AB-']} value={form.bloodGroup} onChange={handleInputChange} />
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1.5">Personal Email <span className="text-red-500">*</span></label>
                  <input type="text" value={email} disabled className="w-full bg-slate-100 border border-slate-300 text-slate-500 px-4 py-2.5 rounded-xl text-sm cursor-not-allowed" />
                </div>
                <Input label="Mobile Number" name="mobile" required value={form.mobile} onChange={handleInputChange} />
                <Input label="Alternate Mobile Number" name="alternateMobile" value={form.alternateMobile} onChange={handleInputChange} />
              </div>
            )}

            {/* STEP 2 */}
            {step === 2 && (
              <div className="space-y-6">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1.5">Current Address <span className="text-red-500">*</span></label>
                  <textarea name="currentAddress" value={form.currentAddress} onChange={handleInputChange} rows={3} className="w-full bg-white border border-slate-300 text-slate-900 px-4 py-2.5 rounded-xl text-sm focus:outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500 resize-none"></textarea>
                </div>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" name="sameAsCurrent" checked={form.sameAsCurrent} onChange={handleInputChange} className="w-4 h-4 text-brand-600 rounded border-slate-300 focus:ring-brand-500" />
                  <span className="text-sm text-slate-700 font-medium">Same as current address</span>
                </label>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1.5">Permanent Address <span className="text-red-500">*</span></label>
                  <textarea name="permanentAddress" value={form.permanentAddress} onChange={handleInputChange} rows={3} disabled={form.sameAsCurrent} className={`w-full border border-slate-300 text-slate-900 px-4 py-2.5 rounded-xl text-sm focus:outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500 resize-none ${form.sameAsCurrent ? 'bg-slate-100' : 'bg-white'}`}></textarea>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                  <Input label="City" name="city" required value={form.city} onChange={handleInputChange} />
                  <Input label="State" name="state" required value={form.state} onChange={handleInputChange} />
                  <Input label="Country" name="country" required value={form.country} onChange={handleInputChange} />
                  <Input label="PIN Code" name="pinCode" required value={form.pinCode} onChange={handleInputChange} />
                </div>
              </div>
            )}

            {/* STEP 3 */}
            {step === 3 && (
              <div className="space-y-6">
                <div className="bg-amber-50 text-amber-700 p-4 rounded-xl text-sm mb-6 border border-amber-200">
                  Note: Aadhaar and PAN are mandatory for background verification.
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                  <Input label="Aadhaar Number" name="aadhaarNumber" required value={form.aadhaarNumber} onChange={handleInputChange} />
                  <Input label="PAN Number" name="panNumber" required value={form.panNumber} onChange={handleInputChange} />
                  <Input label="UAN Number (Optional)" name="uanNumber" value={form.uanNumber} onChange={handleInputChange} />
                  <Input label="Passport Number" name="passportNumber" value={form.passportNumber} onChange={handleInputChange} />
                  <Input label="Driving License Number" name="drivingLicense" value={form.drivingLicense} onChange={handleInputChange} />
                </div>
              </div>
            )}

            {/* STEP 4 */}
            {step === 4 && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                <Input label="Contact Name" name="emergencyContactName" required value={form.emergencyContactName} onChange={handleInputChange} />
                <Input label="Relationship" name="emergencyContactRelationship" required value={form.emergencyContactRelationship} onChange={handleInputChange} />
                <Input label="Contact Number" name="emergencyContactNumber" required value={form.emergencyContactNumber} onChange={handleInputChange} />
                <Input label="Alternate Number" name="emergencyContactAlternate" value={form.emergencyContactAlternate} onChange={handleInputChange} />
              </div>
            )}

            {/* STEP 5 */}
            {step === 5 && (
              <div className="space-y-6">
                {education.map((edu, idx) => (
                  <div key={idx} className="p-5 border border-slate-200 rounded-xl bg-slate-50 relative">
                    {education.length > 1 && (
                      <button onClick={() => removeEducation(idx)} className="absolute top-4 right-4 text-red-400 hover:text-red-600 transition-colors"><Trash2 size={18} /></button>
                    )}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                      <div>
                        <label className="block text-sm font-medium text-slate-700 mb-1.5">Highest Qualification <span className="text-red-500">*</span></label>
                        <select value={edu.highestQualification} onChange={(e) => handleEduChange(idx, 'highestQualification', e.target.value)} required className="w-full bg-white border border-slate-300 text-slate-900 px-4 py-2.5 rounded-xl text-sm focus:outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500">
                          <option value="">Select...</option>
                          {['10th', '12th', 'Diploma', 'UG', 'PG', 'PhD', 'Other'].map(o => <option key={o} value={o}>{o}</option>)}
                        </select>
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-slate-700 mb-1.5">Degree <span className="text-red-500">*</span></label>
                        <input type="text" value={edu.degree} onChange={(e) => handleEduChange(idx, 'degree', e.target.value)} required placeholder="e.g. B.Tech, B.Sc" className="w-full bg-white border border-slate-300 text-slate-900 px-4 py-2.5 rounded-xl text-sm focus:outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500" />
                      </div>
                      <div className="sm:col-span-2">
                        <label className="block text-sm font-medium text-slate-700 mb-1.5">Course / Specialization <span className="text-red-500">*</span></label>
                        <input type="text" value={edu.course} onChange={(e) => handleEduChange(idx, 'course', e.target.value)} required placeholder="e.g. Artificial Intelligence and Data Science, Computer Science" className="w-full bg-white border border-slate-300 text-slate-900 px-4 py-2.5 rounded-xl text-sm focus:outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500" />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-slate-700 mb-1.5">University / Institution <span className="text-red-500">*</span></label>
                        <input type="text" value={edu.universityOrInstitution} onChange={(e) => handleEduChange(idx, 'universityOrInstitution', e.target.value)} required className="w-full bg-white border border-slate-300 text-slate-900 px-4 py-2.5 rounded-xl text-sm focus:outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500" />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-slate-700 mb-1.5">Year of Passing <span className="text-red-500">*</span></label>
                        <input type="number" value={edu.yearOfPassing} onChange={(e) => handleEduChange(idx, 'yearOfPassing', e.target.value)} required min="1950" max={new Date().getFullYear() + 1} className="w-full bg-white border border-slate-300 text-slate-900 px-4 py-2.5 rounded-xl text-sm focus:outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500" />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-slate-700 mb-1.5">Percentage / CGPA <span className="text-red-500">*</span></label>
                        <input type="text" value={edu.percentageOrCgpa} onChange={(e) => handleEduChange(idx, 'percentageOrCgpa', e.target.value)} required placeholder="e.g. 82% or 8.4" className="w-full bg-white border border-slate-300 text-slate-900 px-4 py-2.5 rounded-xl text-sm focus:outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500" />
                      </div>
                    </div>
                  </div>
                ))}
                <button onClick={addEducation} className="flex items-center gap-2 text-brand-600 font-medium hover:text-brand-700 px-2"><Plus size={18} /> Add Education</button>
              </div>
            )}

            {/* STEP 6 */}
            {step === 6 && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                <FileInput label="Resume (PDF/DOC)" name="resume" required accept=".pdf,.doc,.docx" file={files.resume} onChange={handleFileChange} />
                <FileInput label="Aadhaar Card" name="aadhaarCard" required file={files.aadhaarCard} onChange={handleFileChange} />
                <FileInput label="PAN Card" name="panCard" required file={files.panCard} onChange={handleFileChange} />
                <FileInput label="Passport Size Photo" name="passportPhoto" required accept=".jpg,.jpeg,.png" file={files.passportPhoto} onChange={handleFileChange} />
                
                <FileInput label="10th Certificate" name="tenthCertificate" required file={files.tenthCertificate} onChange={handleFileChange} />
                <FileInput label="12th Certificate" name="twelfthCertificate" required file={files.twelfthCertificate} onChange={handleFileChange} />
                <FileInput label="UG Certificate" name="ugCertificate" required file={files.ugCertificate} onChange={handleFileChange} />
                <FileInput label="PG Certificate (Optional)" name="pgCertificate" file={files.pgCertificate} onChange={handleFileChange} />
                <FileInput label="Experience Letters (Optional)" name="experienceLetters" file={files.experienceLetters} onChange={handleFileChange} />
              </div>
            )}
          </div>

          <div className="bg-slate-50 p-6 border-t border-slate-200 flex justify-between">
            <button onClick={prevStep} disabled={step === 1 || submitting} className="flex items-center gap-2 px-5 py-2.5 rounded-xl font-medium text-slate-600 hover:bg-slate-200 transition-colors disabled:opacity-50 disabled:pointer-events-none">
              <ChevronLeft size={18} /> Previous
            </button>
            {step < 6 ? (
              <button onClick={nextStep} className="flex items-center gap-2 bg-brand-600 hover:bg-brand-500 text-white px-6 py-2.5 rounded-xl font-medium transition-colors shadow-lg shadow-brand-500/30">
                Next <ChevronRight size={18} />
              </button>
            ) : (
              <button onClick={handleSubmit} disabled={submitting} className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-500 text-white px-8 py-2.5 rounded-xl font-bold transition-colors shadow-lg shadow-emerald-500/30 disabled:opacity-70">
                {submitting ? <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin"/> : 'Submit Details'}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
