import type { Profile } from "./types";
import { Dropdown } from "./Dropdown";

type Props = {
  profiles: Profile[];
  activeProfile: string | null;
  setActiveProfile: (profileId: string | null) => void;
  activity: { global: number; byProfile: Record<string, number> };
};

// Sidebar profile selector. A thin wrapper over the shared Dropdown that maps
// the empty-string "All profiles" option to/from a null active profile.
export function ProfileSwitcher({ profiles, activeProfile, setActiveProfile, activity }: Props) {
  const options = [
    { value: "", label: "All profiles", detail: activity.global > 0 ? `${activity.global} running` : undefined },
    ...profiles.map((profile) => ({
      value: profile.id,
      label: profile.name,
      detail: activity.byProfile[profile.id] > 0 ? `${activity.byProfile[profile.id]} running` : undefined
    }))
  ];

  return (
    <Dropdown
      variant="toolbar"
      ariaLabel="Active profile"
      value={activeProfile ?? ""}
      options={options}
      onChange={(value) => setActiveProfile(value || null)}
    />
  );
}
