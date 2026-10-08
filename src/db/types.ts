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
    PostgrestVersion: "14.18"
  }
  public: {
    Tables: {
      candidates: {
        Row: {
          aligned_to_moment: number | null
          anchor_seconds: number
          artist: string
          artwork_url: string | null
          canonical_artist: string | null
          canonical_title: string | null
          component_scores: Json | null
          created_at: string
          deezer_id: string | null
          deezer_url: string | null
          directions: string[]
          duration_seconds: number | null
          fit_reason: string
          id: string
          itunes_id: string | null
          preview_source: string | null
          preview_url: string | null
          prompt_version: string
          proposed_end: number
          proposed_start: number
          section_is_vocal: boolean
          section_reason: string
          segment_id: string | null
          song_id: string | null
          source: string
          submission_id: string
          title: string
          total_score: number | null
          verified: boolean
        }
        Insert: {
          aligned_to_moment?: number | null
          anchor_seconds: number
          artist: string
          artwork_url?: string | null
          canonical_artist?: string | null
          canonical_title?: string | null
          component_scores?: Json | null
          created_at?: string
          deezer_id?: string | null
          deezer_url?: string | null
          directions?: string[]
          duration_seconds?: number | null
          fit_reason: string
          id?: string
          itunes_id?: string | null
          preview_source?: string | null
          preview_url?: string | null
          prompt_version: string
          proposed_end: number
          proposed_start: number
          section_is_vocal?: boolean
          section_reason: string
          segment_id?: string | null
          song_id?: string | null
          source?: string
          submission_id: string
          title: string
          total_score?: number | null
          verified?: boolean
        }
        Update: {
          aligned_to_moment?: number | null
          anchor_seconds?: number
          artist?: string
          artwork_url?: string | null
          canonical_artist?: string | null
          canonical_title?: string | null
          component_scores?: Json | null
          created_at?: string
          deezer_id?: string | null
          deezer_url?: string | null
          directions?: string[]
          duration_seconds?: number | null
          fit_reason?: string
          id?: string
          itunes_id?: string | null
          preview_source?: string | null
          preview_url?: string | null
          prompt_version?: string
          proposed_end?: number
          proposed_start?: number
          section_is_vocal?: boolean
          section_reason?: string
          segment_id?: string | null
          song_id?: string | null
          source?: string
          submission_id?: string
          title?: string
          total_score?: number | null
          verified?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "candidates_segment_id_fkey"
            columns: ["segment_id"]
            isOneToOne: false
            referencedRelation: "song_segments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "candidates_song_id_fkey"
            columns: ["song_id"]
            isOneToOne: false
            referencedRelation: "songs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "candidates_submission_id_fkey"
            columns: ["submission_id"]
            isOneToOne: false
            referencedRelation: "submissions"
            referencedColumns: ["id"]
          },
        ]
      }
      creators: {
        Row: {
          created_at: string
          display_name: string | null
          email: string
          id: string
          preferences: Json | null
        }
        Insert: {
          created_at?: string
          display_name?: string | null
          email: string
          id: string
          preferences?: Json | null
        }
        Update: {
          created_at?: string
          display_name?: string | null
          email?: string
          id?: string
          preferences?: Json | null
        }
        Relationships: []
      }
      events: {
        Row: {
          created_at: string
          creator_id: string | null
          id: string
          metadata: Json | null
          name: string
          submission_id: string | null
        }
        Insert: {
          created_at?: string
          creator_id?: string | null
          id?: string
          metadata?: Json | null
          name: string
          submission_id?: string | null
        }
        Update: {
          created_at?: string
          creator_id?: string | null
          id?: string
          metadata?: Json | null
          name?: string
          submission_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "events_creator_id_fkey"
            columns: ["creator_id"]
            isOneToOne: false
            referencedRelation: "creators"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "events_submission_id_fkey"
            columns: ["submission_id"]
            isOneToOne: false
            referencedRelation: "submissions"
            referencedColumns: ["id"]
          },
        ]
      }
      recommendations: {
        Row: {
          aligned_to_moment: number | null
          artist: string
          artwork_url: string | null
          candidate_id: string | null
          created_at: string
          deezer_url: string | null
          direction_label: string
          end_seconds: number
          explain_prompt_version: string | null
          explanation: string
          id: string
          preview_url: string | null
          rank: number
          rejected: boolean
          selected: boolean
          spotify_url: string
          start_seconds: number
          submission_id: string
          title: string
        }
        Insert: {
          aligned_to_moment?: number | null
          artist: string
          artwork_url?: string | null
          candidate_id?: string | null
          created_at?: string
          deezer_url?: string | null
          direction_label: string
          end_seconds: number
          explain_prompt_version?: string | null
          explanation: string
          id?: string
          preview_url?: string | null
          rank: number
          rejected?: boolean
          selected?: boolean
          spotify_url: string
          start_seconds: number
          submission_id: string
          title: string
        }
        Update: {
          aligned_to_moment?: number | null
          artist?: string
          artwork_url?: string | null
          candidate_id?: string | null
          created_at?: string
          deezer_url?: string | null
          direction_label?: string
          end_seconds?: number
          explain_prompt_version?: string | null
          explanation?: string
          id?: string
          preview_url?: string | null
          rank?: number
          rejected?: boolean
          selected?: boolean
          spotify_url?: string
          start_seconds?: number
          submission_id?: string
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "recommendations_candidate_id_fkey"
            columns: ["candidate_id"]
            isOneToOne: false
            referencedRelation: "candidates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recommendations_submission_id_fkey"
            columns: ["submission_id"]
            isOneToOne: false
            referencedRelation: "submissions"
            referencedColumns: ["id"]
          },
        ]
      }
      song_segments: {
        Row: {
          created_at: string
          description: string
          embedding: string | null
          end_seconds: number
          energy: number | null
          id: string
          label: string
          lyrics_snippet: string | null
          moods: string[]
          song_id: string
          start_seconds: number
        }
        Insert: {
          created_at?: string
          description: string
          embedding?: string | null
          end_seconds: number
          energy?: number | null
          id?: string
          label: string
          lyrics_snippet?: string | null
          moods?: string[]
          song_id: string
          start_seconds: number
        }
        Update: {
          created_at?: string
          description?: string
          embedding?: string | null
          end_seconds?: number
          energy?: number | null
          id?: string
          label?: string
          lyrics_snippet?: string | null
          moods?: string[]
          song_id?: string
          start_seconds?: number
        }
        Relationships: [
          {
            foreignKeyName: "song_segments_song_id_fkey"
            columns: ["song_id"]
            isOneToOne: false
            referencedRelation: "songs"
            referencedColumns: ["id"]
          },
        ]
      }
      song_trend_signals: {
        Row: {
          content_categories: string[]
          created_at: string
          growth_score: number
          id: string
          observed_at: string
          platform: string
          popularity_score: number
          saturation_score: number
          song_id: string
          source: string
        }
        Insert: {
          content_categories?: string[]
          created_at?: string
          growth_score: number
          id?: string
          observed_at?: string
          platform: string
          popularity_score: number
          saturation_score: number
          song_id: string
          source: string
        }
        Update: {
          content_categories?: string[]
          created_at?: string
          growth_score?: number
          id?: string
          observed_at?: string
          platform?: string
          popularity_score?: number
          saturation_score?: number
          song_id?: string
          source?: string
        }
        Relationships: [
          {
            foreignKeyName: "song_trend_signals_song_id_fkey"
            columns: ["song_id"]
            isOneToOne: false
            referencedRelation: "songs"
            referencedColumns: ["id"]
          },
        ]
      }
      songs: {
        Row: {
          aesthetics: string[]
          artist: string
          bpm: number | null
          created_at: string
          cultural_tags: string[]
          deezer_id: string | null
          energy: number | null
          genres: string[]
          id: string
          itunes_id: string | null
          language: string | null
          moods: string[]
          title: string
          vocal_type: string | null
        }
        Insert: {
          aesthetics?: string[]
          artist: string
          bpm?: number | null
          created_at?: string
          cultural_tags?: string[]
          deezer_id?: string | null
          energy?: number | null
          genres?: string[]
          id?: string
          itunes_id?: string | null
          language?: string | null
          moods?: string[]
          title: string
          vocal_type?: string | null
        }
        Update: {
          aesthetics?: string[]
          artist?: string
          bpm?: number | null
          created_at?: string
          cultural_tags?: string[]
          deezer_id?: string | null
          energy?: number | null
          genres?: string[]
          id?: string
          itunes_id?: string | null
          language?: string | null
          moods?: string[]
          title?: string
          vocal_type?: string | null
        }
        Relationships: []
      }
      stripe_events: {
        Row: {
          id: string
          processed_at: string
          type: string
        }
        Insert: {
          id: string
          processed_at?: string
          type: string
        }
        Update: {
          id?: string
          processed_at?: string
          type?: string
        }
        Relationships: []
      }
      submissions: {
        Row: {
          analyzed_at: string | null
          content_category: string | null
          created_at: string
          creator_id: string
          creator_intent: string | null
          duration_seconds: number | null
          error: string | null
          id: string
          playback_path: string | null
          recommended_at: string | null
          status: string
          updated_at: string
          vibe_tags: string[]
          video_path: string
          viewed_at: string | null
        }
        Insert: {
          analyzed_at?: string | null
          content_category?: string | null
          created_at?: string
          creator_id: string
          creator_intent?: string | null
          duration_seconds?: number | null
          error?: string | null
          id?: string
          playback_path?: string | null
          recommended_at?: string | null
          status?: string
          updated_at?: string
          vibe_tags?: string[]
          video_path: string
          viewed_at?: string | null
        }
        Update: {
          analyzed_at?: string | null
          content_category?: string | null
          created_at?: string
          creator_id?: string
          creator_intent?: string | null
          duration_seconds?: number | null
          error?: string | null
          id?: string
          playback_path?: string | null
          recommended_at?: string | null
          status?: string
          updated_at?: string
          vibe_tags?: string[]
          video_path?: string
          viewed_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "submissions_creator_id_fkey"
            columns: ["creator_id"]
            isOneToOne: false
            referencedRelation: "creators"
            referencedColumns: ["id"]
          },
        ]
      }
      subscriptions: {
        Row: {
          created_at: string
          creator_id: string
          id: string
          started_at: string
          status: string
          stripe_customer_id: string
          stripe_subscription_id: string | null
        }
        Insert: {
          created_at?: string
          creator_id: string
          id?: string
          started_at?: string
          status: string
          stripe_customer_id: string
          stripe_subscription_id?: string | null
        }
        Update: {
          created_at?: string
          creator_id?: string
          id?: string
          started_at?: string
          status?: string
          stripe_customer_id?: string
          stripe_subscription_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "subscriptions_creator_id_fkey"
            columns: ["creator_id"]
            isOneToOne: false
            referencedRelation: "creators"
            referencedColumns: ["id"]
          },
        ]
      }
      video_analyses: {
        Row: {
          aesthetic: string[]
          content_category: string | null
          content_type: string
          created_at: string
          dialogue_present: boolean
          energy: string
          id: string
          important_moments: Json
          mood: string[]
          music_brief: string
          music_brief_fields: Json
          pacing: string
          prompt_version: string
          raw_response: Json | null
          setting: string | null
          story: string | null
          submission_id: string
          summary: string
          transcript: string | null
        }
        Insert: {
          aesthetic?: string[]
          content_category?: string | null
          content_type: string
          created_at?: string
          dialogue_present?: boolean
          energy: string
          id?: string
          important_moments?: Json
          mood?: string[]
          music_brief: string
          music_brief_fields: Json
          pacing: string
          prompt_version: string
          raw_response?: Json | null
          setting?: string | null
          story?: string | null
          submission_id: string
          summary: string
          transcript?: string | null
        }
        Update: {
          aesthetic?: string[]
          content_category?: string | null
          content_type?: string
          created_at?: string
          dialogue_present?: boolean
          energy?: string
          id?: string
          important_moments?: Json
          mood?: string[]
          music_brief?: string
          music_brief_fields?: Json
          pacing?: string
          prompt_version?: string
          raw_response?: Json | null
          setting?: string | null
          story?: string | null
          submission_id?: string
          summary?: string
          transcript?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "video_analyses_submission_id_fkey"
            columns: ["submission_id"]
            isOneToOne: true
            referencedRelation: "submissions"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      claim_submission_run: {
        Args: { p_id: string }
        Returns: {
          analyzed_at: string | null
          content_category: string | null
          created_at: string
          creator_id: string
          creator_intent: string | null
          duration_seconds: number | null
          error: string | null
          id: string
          playback_path: string | null
          recommended_at: string | null
          status: string
          updated_at: string
          vibe_tags: string[]
          video_path: string
          viewed_at: string | null
        }
        SetofOptions: {
          from: "*"
          to: "submissions"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      create_submission: {
        Args: {
          p_creator_id: string
          p_id: string
          p_intent: string
          p_video_path: string
        }
        Returns: {
          analyzed_at: string | null
          content_category: string | null
          created_at: string
          creator_id: string
          creator_intent: string | null
          duration_seconds: number | null
          error: string | null
          id: string
          playback_path: string | null
          recommended_at: string | null
          status: string
          updated_at: string
          vibe_tags: string[]
          video_path: string
          viewed_at: string | null
        }
        SetofOptions: {
          from: "*"
          to: "submissions"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      exec_sql: { Args: { sql: string }; Returns: undefined }
      metrics_summary: { Args: never; Returns: Json }
      set_recommendation_feedback: {
        Args: {
          p_rank: number
          p_rejected: boolean
          p_selected: boolean
          p_submission_id: string
        }
        Returns: number
      }
    }
    Enums: {
      [_ in never]: never
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
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
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
