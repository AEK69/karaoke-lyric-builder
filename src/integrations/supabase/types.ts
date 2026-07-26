export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      daily_usage: {
        Row: {
          count: number
          used_date: string
          user_id: string
        }
        Insert: {
          count?: number
          used_date?: string
          user_id: string
        }
        Update: {
          count?: number
          used_date?: string
          user_id?: string
        }
        Relationships: []
      }
      payment_requests: {
        Row: {
          admin_note: string | null
          amount: number
          created_at: string
          credits: number
          id: string
          plan_label: string
          premium_days: number
          reviewed_at: string | null
          reviewed_by: string | null
          slip_url: string | null
          status: string
          user_id: string
        }
        Insert: {
          admin_note?: string | null
          amount: number
          created_at?: string
          credits?: number
          id?: string
          plan_label: string
          premium_days?: number
          reviewed_at?: string | null
          reviewed_by?: string | null
          slip_url?: string | null
          status?: string
          user_id: string
        }
        Update: {
          admin_note?: string | null
          amount?: number
          created_at?: string
          credits?: number
          id?: string
          plan_label?: string
          premium_days?: number
          reviewed_at?: string | null
          reviewed_by?: string | null
          slip_url?: string | null
          status?: string
          user_id?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          email: string | null
          extra_credits: number
          full_name: string | null
          id: string
          is_premium: boolean
          premium_until: string | null
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          email?: string | null
          extra_credits?: number
          full_name?: string | null
          id: string
          is_premium?: boolean
          premium_until?: string | null
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          email?: string | null
          extra_credits?: number
          full_name?: string | null
          id?: string
          is_premium?: boolean
          premium_until?: string | null
        }
        Relationships: []
      }
      topup_codes: {
        Row: {
          code: string
          created_at: string
          created_by: string | null
          credits: number
          expires_at: string | null
          id: string
          note: string | null
          premium_days: number
          used_at: string | null
          used_by: string | null
        }
        Insert: {
          code: string
          created_at?: string
          created_by?: string | null
          credits?: number
          expires_at?: string | null
          id?: string
          note?: string | null
          premium_days?: number
          used_at?: string | null
          used_by?: string | null
        }
        Update: {
          code?: string
          created_at?: string
          created_by?: string | null
          credits?: number
          expires_at?: string | null
          id?: string
          note?: string | null
          premium_days?: number
          used_at?: string | null
          used_by?: string | null
        }
        Relationships: []
      }
      translation_history: {
        Row: {
          created_at: string
          direction: string
          id: string
          input_text: string
          output_text: string
          user_id: string
        }
        Insert: {
          created_at?: string
          direction: string
          id?: string
          input_text: string
          output_text: string
          user_id: string
        }
        Update: {
          created_at?: string
          direction?: string
          id?: string
          input_text?: string
          output_text?: string
          user_id?: string
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      admin_add_credits: {
        Args: { p_amount: number; p_user: string }
        Returns: Json
      }
      admin_approve_payment: {
        Args: { p_id: string; p_note?: string }
        Returns: Json
      }
      admin_create_topup_code: {
        Args: {
          p_credits: number
          p_expires_at?: string
          p_note?: string
          p_premium_days: number
        }
        Returns: Json
      }
      admin_grant_premium: {
        Args: { p_days: number; p_user: string }
        Returns: Json
      }
      admin_list_payments: {
        Args: { p_status?: string }
        Returns: {
          admin_note: string
          amount: number
          created_at: string
          credits: number
          email: string
          full_name: string
          id: string
          plan_label: string
          premium_days: number
          slip_url: string
          status: string
          user_id: string
        }[]
      }
      admin_list_topup_codes: {
        Args: { p_filter?: string }
        Returns: {
          code: string
          created_at: string
          credits: number
          expires_at: string
          id: string
          note: string
          premium_days: number
          used_at: string
          used_by: string
        }[]
      }
      admin_reject_payment: {
        Args: { p_id: string; p_note?: string }
        Returns: Json
      }
      admin_reset_credits: { Args: { p_user: string }; Returns: Json }
      admin_revoke_premium: { Args: { p_user: string }; Returns: Json }
      admin_search_users: {
        Args: { p_query?: string }
        Returns: {
          avatar_url: string
          created_at: string
          email: string
          extra_credits: number
          full_name: string
          id: string
          is_premium: boolean
          premium_until: string
        }[]
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      is_valid_payment_plan: {
        Args: {
          p_amount: number
          p_credits: number
          p_plan_label: string
          p_premium_days: number
        }
        Returns: boolean
      }
      log_translation: {
        Args: { p_direction: string; p_input: string; p_output: string }
        Returns: string
      }
      redeem_topup_code: { Args: { p_code: string }; Returns: Json }
      try_consume_translation: { Args: { p_limit?: number }; Returns: Json }
    }
    Enums: {
      app_role: "admin" | "user"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: ["admin", "user"],
    },
  },
} as const
