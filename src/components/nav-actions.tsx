import * as React from "react"

import { Button } from "@/components/ui/button"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar"
import { IconSettings, IconFileText, IconLink, IconCopy, IconCornerUpRight, IconTrash, IconCornerUpLeft, IconChartLine, IconLayoutRows, IconBell, IconArrowUp, IconArrowDown, IconStar, IconDots } from "@tabler/icons-react"

const data = [
  [
    {
      label: "Customize Page",
      icon: (
        <IconSettings
        />
      ),
    },
    {
      label: "Turn into wiki",
      icon: (
        <IconFileText
        />
      ),
    },
  ],
  [
    {
      label: "Copy Link",
      icon: (
        <IconLink
        />
      ),
    },
    {
      label: "Duplicate",
      icon: (
        <IconCopy
        />
      ),
    },
    {
      label: "Move to",
      icon: (
        <IconCornerUpRight
        />
      ),
    },
    {
      label: "Move to Trash",
      icon: (
        <IconTrash
        />
      ),
    },
  ],
  [
    {
      label: "Undo",
      icon: (
        <IconCornerUpLeft
        />
      ),
    },
    {
      label: "View analytics",
      icon: (
        <IconChartLine
        />
      ),
    },
    {
      label: "Version History",
      icon: (
        <IconLayoutRows
        />
      ),
    },
    {
      label: "Show delete pages",
      icon: (
        <IconTrash
        />
      ),
    },
    {
      label: "Notifications",
      icon: (
        <IconBell
        />
      ),
    },
  ],
  [
    {
      label: "Import",
      icon: (
        <IconArrowUp
        />
      ),
    },
    {
      label: "Export",
      icon: (
        <IconArrowDown
        />
      ),
    },
  ],
]
export function NavActions() {
  const [isOpen, setIsOpen] = React.useState(false)
  React.useEffect(() => {
    setIsOpen(true)
  }, [])
  return (
    <div className="flex items-center gap-2 text-sm">
      <div className="hidden font-medium text-muted-foreground md:inline-block">
        Edit Oct 08
      </div>
      <Button variant="ghost" size="icon" className="h-7 w-7">
        <IconStar
        />
      </Button>
      <Popover open={isOpen} onOpenChange={setIsOpen}>
        <PopoverTrigger
          render={
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 data-open:bg-accent"
            />
          }
        >
          <IconDots
          />
        </PopoverTrigger>
        <PopoverContent
          className="w-56 overflow-hidden rounded-lg p-0"
          align="end"
        >
          <Sidebar collapsible="none" className="bg-transparent">
            <SidebarContent>
              {data.map((group, index) => (
                <SidebarGroup key={index} className="border-b last:border-none">
                  <SidebarGroupContent className="gap-0">
                    <SidebarMenu>
                      {group.map((item, index) => (
                        <SidebarMenuItem key={index}>
                          <SidebarMenuButton>
                            {item.icon} <span>{item.label}</span>
                          </SidebarMenuButton>
                        </SidebarMenuItem>
                      ))}
                    </SidebarMenu>
                  </SidebarGroupContent>
                </SidebarGroup>
              ))}
            </SidebarContent>
          </Sidebar>
        </PopoverContent>
      </Popover>
    </div>
  )
}
