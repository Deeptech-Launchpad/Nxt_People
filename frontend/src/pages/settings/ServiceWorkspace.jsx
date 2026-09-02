import React, { useState } from 'react';
import { NavLink, Navigate, useParams } from 'react-router-dom';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { serviceByKey, tabsOf, sectionsOf, flatSectionsOf, BASE } from './serviceCatalog';
import SECTION_SCREENS from './sectionScreens';

// A service's settings workspace: the left rail of sections, and the section.
//
// The service name and its tabs are drawn by the Topbar, in the same navy row
// as the rest of the application chrome. Rendering them here as well is what
// produced three stacked bars where the reference has one.
//
// The whole thing is driven by serviceCatalog, so adding a section is one entry
// there plus one screen in sectionScreens — the nav and the routing follow.
// A tab with no sections is not rendered at all, which is why services here
// have four tabs at most rather than the reference's five.


// A rail group. It opens when one of its children is the active section, and
// can be opened by hand otherwise — the reference expands Organization
// Structure the moment you are inside it.
function RailGroup({ group, service, tabKey, activeKey }) {
  const holdsActive = group.children.some(c => c.key === activeKey);
  const [open, setOpen] = useState(holdsActive);
  const showing = open || holdsActive;

  return (
    <div>
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-1.5 px-3 py-2.5 text-[14px] text-slate-700 hover:bg-slate-50 rounded-lg"
      >
        {showing ? <ChevronDown size={15} className="text-slate-500" /> : <ChevronRight size={15} className="text-slate-500" />}
        <span className={holdsActive ? 'font-semibold text-slate-800' : ''}>{group.label}</span>
      </button>
      {showing && group.children.map(c => (
        <NavLink
          key={c.key}
          to={`${BASE}/${service.key}/${tabKey}/${c.key}`}
          className={({ isActive }) =>
            `block pl-9 pr-4 py-2 text-[14px] rounded-lg transition-colors ${
              isActive ? 'bg-slate-100 font-semibold text-slate-800' : 'text-slate-600 hover:bg-slate-50'
            }`
          }
        >
          {c.label}
        </NavLink>
      ))}
    </div>
  );
}

export default function ServiceWorkspace() {
  const { serviceKey, tabKey, sectionKey } = useParams();

  const service = serviceByKey(serviceKey);
  if (!service) return <Navigate to="/settings" replace />;

  const tabs = tabsOf(service);
  if (!tabs.length) return <Navigate to="/settings" replace />;

  const activeTab = tabs.find(t => t.key === tabKey) || tabs[0];
  const sections = sectionsOf(service, activeTab.key);
  const leaves = flatSectionsOf(service, activeTab.key);
  const activeSection = leaves.find(s => s.key === sectionKey) || leaves[0];

  // Land on the first tab and section rather than rendering a half-chosen URL.
  if (!tabKey || !sectionKey || activeTab.key !== tabKey || activeSection?.key !== sectionKey) {
    return <Navigate to={`${BASE}/${service.key}/${activeTab.key}/${activeSection?.key}`} replace />;
  }

  const Screen = SECTION_SCREENS[`${service.key}.${activeTab.key}.${activeSection.key}`];

  /* The gutter belongs here rather than on the shell's <main>, which is
   * deliberately bare so that full-height pages can size themselves against
   * the viewport. Without it every settings section sat flush against the navy
   * bar and the icon rail — the first line of a section's own text ran under
   * the header. p-5 is the same gutter the Operations workspaces use, so the
   * two halves of the product line up. */
  return (
    <div className="w-full max-w-full min-w-0 p-5">
      <div>
        <div className="flex items-start gap-5">
          {sections.length > 1 && (
          <>
          <nav className="w-[210px] flex-shrink-0 hidden md:block">
          {sections.map(s => (
            s.children
              ? <RailGroup key={s.key} group={s} service={service} tabKey={activeTab.key} activeKey={activeSection?.key} />
              : (
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
              )
          ))}
        </nav>

          <div className="md:hidden w-full overflow-x-auto border-b border-slate-200 pb-2 mb-3">
            <div className="flex gap-1 w-max">
              {leaves.map(s => (
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
          </>
          )}

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
