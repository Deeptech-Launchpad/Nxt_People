import React from 'react';
import { NavLink, Navigate, useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { serviceByKey, tabsOf, sectionsOf, BASE } from './serviceCatalog';
import SECTION_SCREENS from './sectionScreens';

// A service's settings workspace: the service name and its tabs sit together in
// the dark bar, the way the rest of the app's chrome does, then a left rail of
// sections and the section itself.
//
// The whole thing is driven by serviceCatalog, so adding a section is one entry
// there plus one screen in sectionScreens — the nav and the routing follow.
// A tab with no sections is not rendered at all, which is why services here
// have four tabs at most rather than the reference's five.

// The same navy as the application top bar, so the workspace header reads as
// part of the chrome rather than as a card floating on the page.
const NAVY = '#1a2040';

export default function ServiceWorkspace() {
  const { serviceKey, tabKey, sectionKey } = useParams();
  const navigate = useNavigate();

  const service = serviceByKey(serviceKey);
  if (!service) return <Navigate to="/settings" replace />;

  const tabs = tabsOf(service);
  if (!tabs.length) return <Navigate to="/settings" replace />;

  const activeTab = tabs.find(t => t.key === tabKey) || tabs[0];
  const sections = sectionsOf(service, activeTab.key);
  const activeSection = sections.find(s => s.key === sectionKey) || sections[0];

  // Land on the first tab and section rather than rendering a half-chosen URL.
  if (!tabKey || !sectionKey || activeTab.key !== tabKey || activeSection?.key !== sectionKey) {
    return <Navigate to={`${BASE}/${service.key}/${activeTab.key}/${activeSection?.key}`} replace />;
  }

  const Screen = SECTION_SCREENS[`${service.key}.${activeTab.key}.${activeSection.key}`];

  return (
    <div className="w-full max-w-full min-w-0 -mx-4 -mt-4 sm:-mx-6">
      <div style={{ backgroundColor: NAVY }} className="px-4 sm:px-6">
        {/* Name and tabs share one row on a wide screen, exactly as the
            reference has them, and stack only when there is no room. */}
        <div className="flex items-center gap-4 overflow-x-auto">
          <div className="flex items-center gap-3 py-3 flex-shrink-0">
            <button
              onClick={() => navigate('/settings')}
              aria-label="Back to Settings"
              className="w-7 h-7 rounded flex items-center justify-center bg-white/10 hover:bg-white/20 text-white transition-colors"
            >
              <ArrowLeft size={15} />
            </button>
            <h1 className="text-[16px] font-semibold text-white whitespace-nowrap">{service.label}</h1>
          </div>

          <div className="flex items-stretch gap-1 w-max">
            {tabs.map(t => (
              <NavLink
                key={t.key}
                to={`${BASE}/${service.key}/${t.key}`}
                className={() =>
                  `px-4 flex items-center text-[14px] whitespace-nowrap border-b-[3px] transition-colors ${
                    t.key === activeTab.key
                      ? 'border-white text-white font-semibold'
                      : 'border-transparent text-white/65 hover:text-white'
                  }`
                }
              >
                {t.label}
              </NavLink>
            ))}
          </div>
        </div>
      </div>

      <div className="px-4 sm:px-6 pt-5">
        <div className="flex items-start gap-5">
          <nav className="w-[210px] flex-shrink-0 hidden md:block">
            {sections.map(s => (
              <NavLink
                key={s.key}
                to={`${BASE}/${service.key}/${activeTab.key}/${s.key}`}
                className={({ isActive }) =>
                  `block px-4 py-2.5 text-[14px] rounded-lg transition-colors ${
                    isActive ? 'bg-slate-100 font-semibold text-slate-800' : 'text-slate-600 hover:bg-slate-50'
                  }`
                }
              >
                {s.label}
              </NavLink>
            ))}
          </nav>

          <div className="md:hidden w-full overflow-x-auto border-b border-slate-200 pb-2 mb-3">
            <div className="flex gap-1 w-max">
              {sections.map(s => (
                <NavLink
                  key={s.key}
                  to={`${BASE}/${service.key}/${activeTab.key}/${s.key}`}
                  className={({ isActive }) =>
                    `px-3 py-2 text-[13.5px] rounded-lg whitespace-nowrap ${
                      isActive ? 'bg-slate-100 font-semibold text-slate-800' : 'text-slate-600'
                    }`
                  }
                >
                  {s.label}
                </NavLink>
              ))}
            </div>
          </div>

          <div className="flex-1 min-w-0">
            {Screen ? <Screen /> : (
              <div className="bg-white border border-slate-200 rounded-xl px-6 py-10 text-center">
                <p className="text-[14px] text-slate-600">This section has no screen yet.</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
